from __future__ import annotations

import json
import uuid
from contextlib import contextmanager
from datetime import UTC, datetime, timedelta

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import func, select, text, update
from sqlalchemy.orm import Session

from app.api import analysis_stream
from app.api.dependencies import analysis_access
from app.api.dependencies.auth import get_current_user_id
from app.core.config import settings
from app.core.guest_credentials import hash_guest_token
from app.core.safety import CURRENT_SAFETY_ACK_VERSION
from app.main import app
from app.models.analysis import Analysis
from app.models.guest_analysis_usage import GuestAnalysisUsage
from app.models.movement import Movement
from app.models.movement_documentation import MovementDocumentation
from app.models.profile import Profile
from app.models.subscription import FeatureUsage, PlanEntitlement, SubscriptionPlan
from app.models.worker_instance import WorkerInstance
from app.services import analysis as analysis_service
from app.services.analysis_availability import analysis_service_state
from app.services.analysis_jobs import MAX_ANALYSIS_ATTEMPTS, claim_next_analysis
from app.services.worker_monitor import STALE_AFTER_SECONDS

# These tests exercise the real heartbeat-based admission check.
pytestmark = pytest.mark.real_worker_health

FAR_FUTURE = datetime(2099, 6, 1, 12, tzinfo=UTC)


@pytest.fixture
def isolated_queue(db: Session, monkeypatch: pytest.MonkeyPatch) -> None:
    """Hide shared dev-DB workers and jobs; the test transaction rolls back."""
    db.execute(
        update(WorkerInstance)
        .where(WorkerInstance.worker_type == "analysis")
        .values(state="stopped")
    )
    db.execute(
        update(Analysis)
        .where(Analysis.status.in_(["queued", "running"]))
        .values(
            status="completed",
            stage="completed",
            claim_token=None,
            lease_expires_at=None,
        )
    )
    db.flush()
    # Keep guest quotas out of the way: a far-future day and window has no
    # prior reservations in the shared database.
    monkeypatch.setattr(analysis_service, "_utc_now", lambda: FAR_FUTURE)
    monkeypatch.setattr(settings, "guest_reservations_per_window", 1000)
    monkeypatch.setattr(settings, "guest_global_daily_limit", 100000)


@pytest.fixture
def guide(db: Session, isolated_queue) -> tuple[Movement, MovementDocumentation]:
    suffix = uuid.uuid4().hex[:8]
    movement = Movement(
        slug=f"queue-status-{suffix}",
        name="Queue status pull",
        family_key="vertical_pull",
        upload_analysis_supported=True,
        live_coach_supported=False,
    )
    db.add(movement)
    db.flush()
    documentation = MovementDocumentation(
        movement_id=movement.id,
        version=1,
        status="published",
        content={"notice": "Use a stable bar."},
        published_at=datetime.now(UTC),
    )
    db.add(documentation)
    db.flush()
    return movement, documentation


def add_worker(
    db: Session, *, state: str = "idle", age_seconds: int = 0
) -> WorkerInstance:
    now = db.scalar(select(func.now()))
    worker = WorkerInstance(
        id=uuid.uuid4(),
        worker_type="analysis",
        state=state,
        last_seen_at=now - timedelta(seconds=age_seconds),
    )
    db.add(worker)
    db.flush()
    return worker


def kill_workers(db: Session) -> None:
    db.execute(
        update(WorkerInstance)
        .where(WorkerInstance.worker_type == "analysis")
        .values(last_seen_at=func.now() - timedelta(seconds=STALE_AFTER_SECONDS + 1))
    )
    db.flush()


def add_queued(
    db: Session,
    guide: tuple[Movement, MovementDocumentation],
    *,
    minutes_ago: int,
    credential: str | None = None,
    **overrides,
) -> Analysis:
    movement, documentation = guide
    now = datetime.now(UTC)
    values = {
        "movement_id": movement.id,
        "safety_documentation_id": documentation.id,
        "safety_ack_version": "v1",
        "safety_acknowledged_at": now,
        "owner_kind": "guest",
        "status": "queued",
        "stage": "queued",
        "video_path": f"analyses/{uuid.uuid4()}/source.mp4",
        "guest_token_hash": hash_guest_token(
            credential or f"oa_guest_{uuid.uuid4().hex}", settings.guest_token_secret
        ),
        "guest_rate_key": "queue-status-test",
        "reservation_operation_key": str(uuid.uuid4()),
        "request_fingerprint": uuid.uuid4().hex,
        "reservation_expires_at": now + timedelta(minutes=15),
        "access_expires_at": now + timedelta(hours=1),
        "purge_after": now + timedelta(days=1),
        # Rows in one test transaction would otherwise share now().
        "created_at": now - timedelta(minutes=minutes_ago),
    }
    values.update(overrides)
    analysis = Analysis(**values)
    db.add(analysis)
    db.flush()
    return analysis


def reserve_guest(client: TestClient, guide) -> object:
    movement, documentation = guide
    return client.post(
        "/analyses/guest",
        headers={"Idempotency-Key": str(uuid.uuid4())},
        json={
            "movement_id": str(movement.id),
            "safety_documentation_id": str(documentation.id),
            "safety_ack_version": CURRENT_SAFETY_ACK_VERSION,
        },
    )


def bearer(credential: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {credential}"}


# ---------------------------------------------------------------------------
# Service state and admission
# ---------------------------------------------------------------------------


def test_healthy_idle_worker_reports_ready_and_accepts_uploads(
    client: TestClient, db: Session, guide
) -> None:
    add_worker(db, state="idle")

    assert client.get("/analyses/availability").json() == {"state": "ready"}
    response = reserve_guest(client, guide)
    assert response.status_code == 201, response.text


def test_healthy_busy_worker_reports_busy_and_still_accepts_uploads(
    client: TestClient, db: Session, guide
) -> None:
    add_worker(db, state="busy")
    assert client.get("/analyses/availability").json() == {"state": "busy"}
    assert reserve_guest(client, guide).status_code == 201


def test_waiting_jobs_report_busy_even_with_an_idle_worker(
    client: TestClient, db: Session, guide
) -> None:
    add_worker(db, state="idle")
    add_queued(db, guide, minutes_ago=1)
    assert client.get("/analyses/availability").json() == {"state": "busy"}


@pytest.mark.parametrize(
    ("state", "age_seconds"),
    [
        ("idle", STALE_AFTER_SECONDS + 1),
        ("busy", STALE_AFTER_SECONDS + 60),
        ("stopped", 0),
        ("failed", 0),
    ],
)
def test_unhealthy_workers_do_not_count(
    db: Session, isolated_queue, state: str, age_seconds: int
) -> None:
    add_worker(db, state=state, age_seconds=age_seconds)
    assert analysis_service_state(db) == "unavailable"


def test_no_healthy_worker_rejects_new_guest_analysis_without_side_effects(
    client: TestClient, db: Session, guide
) -> None:
    movement, _ = guide
    assert client.get("/analyses/availability").json() == {"state": "unavailable"}

    response = reserve_guest(client, guide)

    assert response.status_code == 503
    assert response.headers["Retry-After"] == "30"
    assert response.json()["error"] == {
        "code": "analysis_service_unavailable",
        "message": (
            "Video analysis is temporarily unavailable. Please try again shortly."
        ),
    }
    assert (
        db.scalar(
            select(func.count(Analysis.id)).where(Analysis.movement_id == movement.id)
        )
        == 0
    )
    assert (
        db.scalar(
            select(func.count(GuestAnalysisUsage.id)).where(
                GuestAnalysisUsage.usage_date == FAR_FUTURE.date()
            )
        )
        == 0
    )


def test_worker_dying_after_the_page_check_is_caught_at_reservation(
    client: TestClient, db: Session, guide
) -> None:
    add_worker(db, state="idle")
    assert client.get("/analyses/availability").json() == {"state": "ready"}

    kill_workers(db)

    response = reserve_guest(client, guide)
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "analysis_service_unavailable"


def test_availability_response_exposes_no_worker_internals(
    client: TestClient, db: Session, isolated_queue
) -> None:
    worker = add_worker(db, state="busy")
    body = client.get("/analyses/availability").text
    assert json.loads(body) == {"state": "busy"}
    assert str(worker.id) not in body


# ---------------------------------------------------------------------------
# Authenticated admission
# ---------------------------------------------------------------------------


@pytest.fixture
def athlete(db: Session, guide, monkeypatch: pytest.MonkeyPatch):
    user_id = uuid.uuid4()
    db.execute(text("INSERT INTO auth.users (id) VALUES (:id)"), {"id": user_id})
    db.add(Profile(id=user_id, display_name="Queue athlete", app_role="athlete"))
    entitlement = db.scalar(
        select(PlanEntitlement)
        .join(SubscriptionPlan, SubscriptionPlan.id == PlanEntitlement.plan_id)
        .where(
            SubscriptionPlan.code == "free",
            PlanEntitlement.feature_key == "video_analysis",
        )
    )
    assert entitlement is not None
    entitlement.allowance_units = 100
    db.flush()

    def verify(token: str) -> uuid.UUID:
        if token != "athlete-token":
            raise HTTPException(status_code=401, detail="Invalid token.")
        return user_id

    monkeypatch.setattr(analysis_access, "verify_access_token", verify)
    app.dependency_overrides[get_current_user_id] = lambda: user_id
    yield user_id
    app.dependency_overrides.pop(get_current_user_id, None)


def reserve_authenticated(client: TestClient, guide):
    movement, documentation = guide
    return client.post(
        "/analyses",
        headers={
            **bearer("athlete-token"),
            "Idempotency-Key": str(uuid.uuid4()),
        },
        json={
            "movement_id": str(movement.id),
            "safety_documentation_id": str(documentation.id),
            "safety_ack_version": CURRENT_SAFETY_ACK_VERSION,
        },
    )


def test_authenticated_analysis_is_rejected_without_reserving_allowance(
    client: TestClient, db: Session, guide, athlete
) -> None:
    response = reserve_authenticated(client, guide)

    assert response.status_code == 503
    assert response.json()["error"]["code"] == "analysis_service_unavailable"
    assert (
        db.scalar(
            select(func.count(FeatureUsage.id)).where(FeatureUsage.user_id == athlete)
        )
        == 0
    )
    assert (
        db.scalar(select(func.count(Analysis.id)).where(Analysis.user_id == athlete))
        == 0
    )


def test_authenticated_analysis_is_accepted_with_a_healthy_worker(
    client: TestClient, db: Session, guide, athlete
) -> None:
    add_worker(db, state="busy")
    response = reserve_authenticated(client, guide)
    assert response.status_code == 201, response.text


def test_authenticated_status_includes_queue_and_stays_owner_only(
    client: TestClient, db: Session, guide, athlete
) -> None:
    add_worker(db, state="busy")
    add_queued(db, guide, minutes_ago=5)
    own = add_queued(
        db,
        guide,
        minutes_ago=1,
        owner_kind="authenticated",
        user_id=athlete,
        guest_token_hash=None,
        guest_rate_key=None,
        access_expires_at=None,
        purge_after=None,
    )

    response = client.get(f"/analyses/{own.id}/status", headers=bearer("athlete-token"))
    assert response.status_code == 200
    assert response.json()["queue"] == {"service_state": "busy", "analyses_ahead": 1}
    assert (
        client.get(f"/analyses/{own.id}/status", headers=bearer("other")).status_code
        == 401
    )


# ---------------------------------------------------------------------------
# Admitted work when the worker disappears
# ---------------------------------------------------------------------------


def test_queued_analysis_stays_queued_when_worker_disappears_and_resumes(
    client: TestClient, db: Session, guide
) -> None:
    credential = f"oa_guest_{uuid.uuid4().hex}"
    add_worker(db, state="idle")
    analysis = add_queued(db, guide, minutes_ago=1, credential=credential)

    kill_workers(db)

    status = client.get(f"/analyses/{analysis.id}/status", headers=bearer(credential))
    assert status.status_code == 200
    assert status.json() == {
        "analysis_id": str(analysis.id),
        "status": "queued",
        "stage": "queued",
        "queue": {"service_state": "unavailable", "analyses_ahead": 0},
    }
    db.refresh(analysis)
    assert analysis.status == "queued"
    assert analysis.video_path is not None

    # A worker comes back and claims the same job through the normal path.
    add_worker(db, state="idle")
    assert (
        client.get(
            f"/analyses/{analysis.id}/status", headers=bearer(credential)
        ).json()["queue"]["service_state"]
        == "busy"
    )
    claim = claim_next_analysis(db)
    assert claim is not None and claim.analysis_id == analysis.id

    running = client.get(f"/analyses/{analysis.id}/status", headers=bearer(credential))
    assert running.json()["status"] == "running"
    assert running.json()["queue"]["analyses_ahead"] is None


def test_finalize_is_not_blocked_once_the_reservation_was_admitted(
    client: TestClient, db: Session, guide, monkeypatch: pytest.MonkeyPatch
) -> None:
    from types import SimpleNamespace

    from app.services import analysis_storage

    class Bucket:
        def create_signed_upload_url(self, path: str) -> dict[str, str]:
            return {"token": "signed-upload"}

    monkeypatch.setattr(
        analysis_storage,
        "supabase",
        SimpleNamespace(storage=SimpleNamespace(from_=lambda name: Bucket())),
    )
    monkeypatch.setattr(analysis_storage, "_download_uploaded_video", lambda path: b"v")
    monkeypatch.setattr(analysis_storage, "_validate_video_bytes", lambda *a, **k: None)

    add_worker(db, state="idle")
    reservation = reserve_guest(client, guide)
    assert reservation.status_code == 201
    credential = reservation.json()["credential"]
    analysis_id = reservation.json()["analysis_id"]

    kill_workers(db)

    assert (
        client.post(
            f"/analyses/{analysis_id}/upload", headers=bearer(credential)
        ).status_code
        == 200
    )
    finalized = client.post(
        f"/analyses/{analysis_id}/finalize", headers=bearer(credential)
    )
    assert finalized.status_code == 200, finalized.text
    status = client.get(f"/analyses/{analysis_id}/status", headers=bearer(credential))
    assert status.json()["status"] == "queued"
    assert status.json()["queue"]["service_state"] == "unavailable"


# ---------------------------------------------------------------------------
# Queue position
# ---------------------------------------------------------------------------


def test_queue_position_follows_claim_order_and_skips_unclaimable_jobs(
    client: TestClient, db: Session, guide
) -> None:
    credential = f"oa_guest_{uuid.uuid4().hex}"
    add_worker(db, state="busy")
    first = add_queued(db, guide, minutes_ago=30)
    add_queued(db, guide, minutes_ago=20)
    # Not ahead: claim_next_analysis never takes these before a queued job.
    add_queued(db, guide, minutes_ago=25, attempts=MAX_ANALYSIS_ATTEMPTS)
    add_queued(
        db, guide, minutes_ago=25, access_expires_at=FAR_FUTURE.replace(year=2000)
    )
    add_queued(
        db, guide, minutes_ago=25, status="reserved", stage="reserved", video_path=None
    )
    add_queued(
        db,
        guide,
        minutes_ago=25,
        status="running",
        stage="processing_started",
        claim_token="lost",
        lease_expires_at=datetime.now(UTC) - timedelta(minutes=1),
    )
    mine = add_queued(db, guide, minutes_ago=10, credential=credential)
    add_queued(db, guide, minutes_ago=5)  # queued after mine

    body = client.get(f"/analyses/{mine.id}/status", headers=bearer(credential)).json()
    assert body["queue"] == {"service_state": "busy", "analyses_ahead": 2}

    # The worker first fails the exhausted job (returning no claim), then
    # takes the oldest queued job, so the count shrinks.
    assert claim_next_analysis(db) is None
    claim = claim_next_analysis(db)
    assert claim is not None and claim.analysis_id == first.id
    body = client.get(f"/analyses/{mine.id}/status", headers=bearer(credential)).json()
    assert body["queue"]["analyses_ahead"] == 1


def test_queue_status_leaks_no_other_analysis_details(
    client: TestClient, db: Session, guide
) -> None:
    credential = f"oa_guest_{uuid.uuid4().hex}"
    worker = add_worker(db, state="busy")
    other = add_queued(db, guide, minutes_ago=10)
    mine = add_queued(db, guide, minutes_ago=1, credential=credential)

    response = client.get(f"/analyses/{mine.id}/status", headers=bearer(credential))
    assert set(response.json()) == {"analysis_id", "status", "stage", "queue"}
    assert set(response.json()["queue"]) == {"service_state", "analyses_ahead"}
    for secret in (str(other.id), str(worker.id), other.video_path):
        assert secret not in response.text

    # Guest authorization is unchanged: the ID alone or another guest's
    # credential never reveals queue information.
    assert client.get(f"/analyses/{other.id}/status").status_code == 401
    assert (
        client.get(
            f"/analyses/{other.id}/status", headers=bearer(credential)
        ).status_code
        == 401
    )


def test_terminal_analysis_has_no_queue_block(
    client: TestClient, db: Session, guide
) -> None:
    credential = f"oa_guest_{uuid.uuid4().hex}"
    analysis = add_queued(
        db,
        guide,
        minutes_ago=1,
        credential=credential,
        status="failed",
        stage="failed",
    )
    body = client.get(
        f"/analyses/{analysis.id}/status", headers=bearer(credential)
    ).json()
    assert body["queue"] is None


# ---------------------------------------------------------------------------
# Live stream
# ---------------------------------------------------------------------------


def test_stream_sends_queue_snapshot_for_waiting_analysis(
    client: TestClient, db: Session, guide, monkeypatch: pytest.MonkeyPatch
) -> None:
    credential = f"oa_guest_{uuid.uuid4().hex}"
    add_worker(db, state="busy")
    add_queued(db, guide, minutes_ago=10)
    mine = add_queued(
        db,
        guide,
        minutes_ago=1,
        credential=credential,
        status="failed",
        stage="failed",
    )
    db.commit()

    @contextmanager
    def same_session():
        yield db

    monkeypatch.setattr(analysis_stream, "SessionLocal", same_session)
    # A failed analysis ends the stream immediately, and has no queue block.
    body = client.get(f"/analyses/{mine.id}/events", headers=bearer(credential)).text
    assert "event: queue" not in body

    assert analysis_stream.read_queue_status(mine.id) is None
    mine.status, mine.stage = "queued", "queued"
    db.flush()
    assert analysis_stream.read_queue_status(mine.id) == {
        "service_state": "busy",
        "analyses_ahead": 1,
    }


@pytest.mark.asyncio
async def test_stream_emits_queue_changes_only(monkeypatch: pytest.MonkeyPatch) -> None:
    analysis_id = uuid.uuid4()
    future = datetime.now(UTC) + timedelta(hours=1)
    progress = iter(
        [
            ([], "queued", "queued", "pending", future),
            ([], "queued", "queued", "pending", future),
            ([], "queued", "queued", "pending", future),
            ([], "failed", "failed", "skipped", future),
        ]
    )
    queue = iter(
        [
            {"service_state": "busy", "analyses_ahead": 1},
            {"service_state": "busy", "analyses_ahead": 1},
            {"service_state": "unavailable", "analyses_ahead": 0},
        ]
    )

    class ConnectedRequest:
        async def is_disconnected(self):
            return False

    async def no_wait(_seconds):
        return None

    monkeypatch.setattr(
        analysis_stream, "read_progress", lambda _id, _c: next(progress)
    )
    monkeypatch.setattr(analysis_stream, "read_queue_status", lambda _id: next(queue))
    monkeypatch.setattr(analysis_stream, "QUEUE_REFRESH_SECONDS", 0)
    monkeypatch.setattr(analysis_stream.asyncio, "sleep", no_wait)

    output = [
        event
        async for event in analysis_stream.stream_progress(
            ConnectedRequest(), analysis_id, 0
        )
    ]
    assert [event["event"] for event in output] == ["state", "queue", "queue"]
    assert all("id" not in event for event in output)
    assert [json.loads(event["data"]) for event in output[1:]] == [
        {"service_state": "busy", "analyses_ahead": 1},
        {"service_state": "unavailable", "analyses_ahead": 0},
    ]
