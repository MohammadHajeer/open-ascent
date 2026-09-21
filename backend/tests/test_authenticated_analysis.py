from __future__ import annotations

import uuid
from contextlib import contextmanager
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import delete, func, select, text
from sqlalchemy.orm import Session

from app.api import analysis_stream
from app.api.dependencies import analysis_access
from app.api.dependencies.auth import get_current_user_id
from app.core.config import settings
from app.core.safety import CURRENT_SAFETY_ACK_VERSION
from app.main import app
from app.models.analysis import Analysis
from app.models.enums import FeatureUsageStatus
from app.models.movement import Movement
from app.models.movement_documentation import MovementDocumentation
from app.models.profile import Profile
from app.models.subscription import (
    FeatureUsage,
    PlanEntitlement,
    SubscriptionPlan,
    UserSubscription,
)
from app.services import analysis_storage, authenticated_media_cleanup
from app.services.analysis_jobs import (
    claim_next_analysis,
    complete_analysis,
    fail_analysis,
)
from app.services.authenticated_media_cleanup import (
    cleanup_authenticated_analysis_media,
)
from app.services.guest_cleanup import cleanup_expired_guest_analyses


def _result() -> dict:
    return {
        "outcome": "completed",
        "duration_ms": 1500,
        "valid_rep_count": 1,
        "partial_rep_count": 0,
        "uncertain_rep_count": 0,
        "reps": [
            {
                "rep_index": 1,
                "outcome": "valid",
                "start_ms": 0,
                "end_ms": 1200,
                "top_ms": 600,
                "phase_events": [],
                "reason_codes": [],
                "variations": {"base_movement": "pull_up"},
                "target_match": True,
                "target_deviations": [],
            }
        ],
        "evidence": {
            "total_sampled_frames": 30,
            "usable_pose_frames": 30,
            "usable_pose_ratio": 1.0,
            "hang_confirmed": True,
            "reason_codes": [],
        },
    }


def _explanation() -> dict:
    grounded = {"text": "Persisted guidance.", "evidence": []}
    return {
        "summary": grounded,
        "uncertainty_note": None,
        "key_findings": [],
        "next_set_focus": grounded,
        "safety_note": None,
    }


@pytest.fixture
def auth_analysis_data(db: Session, monkeypatch: pytest.MonkeyPatch):
    user_a, user_b = uuid.uuid4(), uuid.uuid4()
    for user_id in (user_a, user_b):
        db.execute(text("INSERT INTO auth.users (id) VALUES (:id)"), {"id": user_id})
        db.add(Profile(id=user_id, display_name="AUTH-06 athlete", app_role="athlete"))
    movement = Movement(
        slug=f"auth-analysis-{uuid.uuid4().hex[:8]}",
        name="Authenticated pull",
        family_key="vertical_pull",
        upload_analysis_supported=True,
        live_coach_supported=False,
    )
    db.add(movement)
    db.flush()
    guide = MovementDocumentation(
        movement_id=movement.id,
        version=1,
        status="published",
        content={"notice": "Use a stable bar."},
        published_at=datetime.now(UTC),
    )
    db.add(guide)
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
    db.commit()

    tokens = {"token-a": user_a, "token-b": user_b}

    def verify(token: str) -> uuid.UUID:
        try:
            return tokens[token]
        except KeyError as exc:
            raise HTTPException(status_code=401, detail="Invalid token.") from exc

    monkeypatch.setattr(analysis_access, "verify_access_token", verify)
    yield user_a, user_b, movement, guide
    app.dependency_overrides.pop(get_current_user_id, None)


def _authenticate(user_id: uuid.UUID) -> dict[str, str]:
    app.dependency_overrides[get_current_user_id] = lambda: user_id
    return {"Authorization": "Bearer token-a" if str(user_id) else ""}


def _reserve(
    client: TestClient,
    user_id: uuid.UUID,
    movement: Movement,
    guide: MovementDocumentation,
    token: str,
    operation_key: uuid.UUID | None = None,
):
    app.dependency_overrides[get_current_user_id] = lambda: user_id
    return client.post(
        "/analyses",
        headers={
            "Authorization": f"Bearer {token}",
            "Idempotency-Key": str(operation_key or uuid.uuid4()),
        },
        json={
            "movement_id": str(movement.id),
            "safety_documentation_id": str(guide.id),
            "safety_ack_version": CURRENT_SAFETY_ACK_VERSION,
        },
    )


def _video_entitlement(db: Session, plan_code: str) -> PlanEntitlement:
    entitlement = db.scalar(
        select(PlanEntitlement)
        .join(SubscriptionPlan, SubscriptionPlan.id == PlanEntitlement.plan_id)
        .where(
            SubscriptionPlan.code == plan_code,
            PlanEntitlement.feature_key == "video_analysis",
        )
    )
    assert entitlement is not None
    return entitlement


def _activate_verified_pro(db: Session, user_id: uuid.UUID) -> None:
    now = datetime.now(UTC)
    pro = db.scalar(select(SubscriptionPlan).where(SubscriptionPlan.code == "pro"))
    subscription = db.scalar(
        select(UserSubscription).where(UserSubscription.user_id == user_id)
    )
    assert pro is not None and subscription is not None
    if pro.stripe_price_id is None:
        pro.stripe_price_id = f"price_sub04_{uuid.uuid4().hex}"
    subscription.plan_id = pro.id
    subscription.provider_status = "active"
    subscription.stripe_subscription_id = f"sub_sub04_{uuid.uuid4().hex}"
    subscription.last_verified_at = now - timedelta(minutes=1)
    subscription.effective_start = now - timedelta(days=1)
    subscription.effective_end = now + timedelta(days=30)
    subscription.current_period_start = now - timedelta(days=1)
    subscription.current_period_end = now + timedelta(days=30)
    db.commit()


def test_video_analysis_enforces_free_and_pro_configured_allowances(
    client: TestClient,
    db: Session,
    auth_analysis_data,
) -> None:
    free_user, pro_user, movement, guide = auth_analysis_data
    _video_entitlement(db, "free").allowance_units = 1
    _video_entitlement(db, "pro").allowance_units = 2
    _activate_verified_pro(db, pro_user)

    assert _reserve(client, free_user, movement, guide, "token-a").status_code == 201
    free_denied = _reserve(client, free_user, movement, guide, "token-a")
    assert free_denied.status_code == 429
    assert free_denied.json() == {
        "error": {
            "code": "http_error",
            "message": "Video analysis allowance is exhausted for this period.",
        }
    }

    assert _reserve(client, pro_user, movement, guide, "token-b").status_code == 201
    assert _reserve(client, pro_user, movement, guide, "token-b").status_code == 201
    assert _reserve(client, pro_user, movement, guide, "token-b").status_code == 429


def test_zero_allowance_blocks_analysis_even_with_a_pro_plan_hint(
    client: TestClient,
    db: Session,
    auth_analysis_data,
) -> None:
    user_a, _, movement, guide = auth_analysis_data
    _video_entitlement(db, "free").allowance_units = 0
    db.commit()
    app.dependency_overrides[get_current_user_id] = lambda: user_a

    response = client.post(
        "/analyses",
        headers={
            "Authorization": "Bearer token-with-effective-plan-pro-claim",
            "Idempotency-Key": str(uuid.uuid4()),
            "X-Effective-Plan": "pro",
        },
        json={
            "movement_id": str(movement.id),
            "safety_documentation_id": str(guide.id),
            "safety_ack_version": CURRENT_SAFETY_ACK_VERSION,
        },
    )

    assert response.status_code == 429
    assert db.scalar(
        select(func.count(FeatureUsage.id)).where(FeatureUsage.user_id == user_a)
    ) == 0


def test_safety_guidance_remains_accessible_with_zero_allowance(
    client: TestClient,
    db: Session,
    auth_analysis_data,
) -> None:
    user_a, _, _, _ = auth_analysis_data
    for plan_code in ("free", "pro"):
        _video_entitlement(db, plan_code).allowance_units = 0
    db.commit()
    app.dependency_overrides[get_current_user_id] = lambda: user_a

    response = client.get(
        "/profiles/onboarding/config",
        headers={"Authorization": "Bearer token-a"},
    )

    assert response.status_code == 200
    assert response.json()["safety_guidance"]
    assert db.scalar(
        select(func.count(FeatureUsage.id)).where(FeatureUsage.user_id == user_a)
    ) == 0


def test_authenticated_retry_reuses_analysis_and_usage(
    client: TestClient,
    db: Session,
    auth_analysis_data,
) -> None:
    user_a, _, movement, guide = auth_analysis_data
    operation_key = uuid.uuid4()

    first = _reserve(
        client, user_a, movement, guide, "token-a", operation_key=operation_key
    )
    retry = _reserve(
        client, user_a, movement, guide, "token-a", operation_key=operation_key
    )

    assert first.status_code == retry.status_code == 201
    assert first.json()["analysis_id"] == retry.json()["analysis_id"]
    assert (
        db.scalar(
            select(func.count(FeatureUsage.id)).where(FeatureUsage.user_id == user_a)
        )
        == 1
    )


def test_terminal_analysis_failure_releases_usage(
    client: TestClient,
    db: Session,
    auth_analysis_data,
) -> None:
    user_a, _, movement, guide = auth_analysis_data
    created = _reserve(client, user_a, movement, guide, "token-a")
    analysis = db.get(Analysis, uuid.UUID(created.json()["analysis_id"]))
    analysis.status = "queued"
    analysis.stage = "queued"
    analysis.video_path = f"analyses/{analysis.id}/source.mp4"
    db.commit()

    claim = claim_next_analysis(db)
    assert claim is not None and claim.analysis_id == analysis.id
    fail_analysis(db, claim, error_code="test_processing_error")

    usage = db.get(FeatureUsage, analysis.feature_usage_id)
    assert usage.status == FeatureUsageStatus.RELEASED.value
    assert usage.release_reason == "analysis_failed:test_processing_error"


class FakeBucket:
    def __init__(self) -> None:
        self.signed: list[str] = []
        self.removed: list[list[str]] = []

    def create_signed_upload_url(self, path: str) -> dict[str, str]:
        self.signed.append(path)
        return {"token": "signed-upload"}

    def remove(self, paths: list[str]) -> list[dict]:
        self.removed.append(paths)
        return []


class FakeStorage:
    def __init__(self, bucket: FakeBucket) -> None:
        self.bucket = bucket

    def from_(self, name: str) -> FakeBucket:
        assert name == settings.supabase_video_bucket
        return self.bucket


def test_authenticated_reservation_upload_finalize_and_worker_reuse(
    client: TestClient,
    db: Session,
    auth_analysis_data,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user_a, _, movement, guide = auth_analysis_data
    bucket = FakeBucket()
    monkeypatch.setattr(
        analysis_storage,
        "supabase",
        SimpleNamespace(storage=FakeStorage(bucket)),
    )
    monkeypatch.setattr(
        analysis_storage, "_download_uploaded_video", lambda path: b"video"
    )
    monkeypatch.setattr(analysis_storage, "_validate_video_bytes", lambda value: None)

    response = _reserve(client, user_a, movement, guide, "token-a")
    assert response.status_code == 201, response.text
    analysis_id = uuid.UUID(response.json()["analysis_id"])
    analysis = db.get(Analysis, analysis_id)
    assert analysis.owner_kind == "authenticated"
    assert analysis.user_id == user_a
    assert analysis.guest_token_hash is None
    usage = db.get(FeatureUsage, analysis.feature_usage_id)
    assert usage is not None
    assert usage.status == FeatureUsageStatus.RESERVED.value

    headers = {"Authorization": "Bearer token-a"}
    upload = client.post(f"/analyses/{analysis_id}/upload", headers=headers)
    assert upload.status_code == 200
    assert upload.json()["path"] == f"analyses/{analysis_id}/source.mp4"
    finalized = client.post(f"/analyses/{analysis_id}/finalize", headers=headers)
    assert finalized.status_code == 200
    claim = claim_next_analysis(db)
    assert claim is not None and claim.analysis_id == analysis_id
    complete_analysis(
        db,
        claim,
        result_data=_result(),
        analyzer_version="auth-06-test",
        model_version="deterministic-test",
    )
    db.refresh(analysis)
    db.refresh(usage)
    assert analysis.status == "completed"
    assert usage.status == FeatureUsageStatus.CONSUMED.value
    assert analysis.video_delete_after is not None


def test_owner_access_history_and_cross_user_isolation(
    client: TestClient,
    db: Session,
    auth_analysis_data,
) -> None:
    user_a, user_b, movement, guide = auth_analysis_data
    created = _reserve(client, user_a, movement, guide, "token-a")
    analysis = db.get(Analysis, uuid.UUID(created.json()["analysis_id"]))
    analysis.status = "completed"
    analysis.stage = "completed"
    analysis.result = _result()
    analysis.completed_at = datetime.now(UTC)
    analysis.ai_feedback_status = "completed"
    analysis.ai_explanation = _explanation()
    analysis.valid_rep_count = 1
    db.commit()

    owner = {"Authorization": "Bearer token-a"}
    other = {"Authorization": "Bearer token-b"}
    assert (
        client.get(f"/analyses/{analysis.id}/status", headers=owner).status_code == 200
    )
    result = client.get(f"/analyses/{analysis.id}/result", headers=owner)
    assert result.status_code == 200
    assert result.json()["explanation"]["summary"]["text"] == "Persisted guidance."
    for method, suffix in ((client.get, "status"), (client.get, "result")):
        assert (
            method(f"/analyses/{analysis.id}/{suffix}", headers=other).status_code
            == 404
        )
    assert (
        client.post(f"/analyses/{analysis.id}/upload", headers=other).status_code == 404
    )
    assert (
        client.post(f"/analyses/{analysis.id}/finalize", headers=other).status_code
        == 404
    )
    assert (
        client.post(
            f"/analyses/{analysis.id}/explanation/retry", headers=other
        ).status_code
        == 404
    )

    app.dependency_overrides[get_current_user_id] = lambda: user_a
    history_a = client.get("/analyses", headers=owner)
    assert history_a.status_code == 200
    assert [item["analysis_id"] for item in history_a.json()] == [str(analysis.id)]
    app.dependency_overrides[get_current_user_id] = lambda: user_b
    history_b = client.get("/analyses", headers=other)
    assert history_b.status_code == 200
    assert all(item["analysis_id"] != str(analysis.id) for item in history_b.json())


def test_authenticated_sse_owner_only(
    client: TestClient,
    db: Session,
    auth_analysis_data,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user_a, _, movement, guide = auth_analysis_data
    created = _reserve(client, user_a, movement, guide, "token-a")
    analysis = db.get(Analysis, uuid.UUID(created.json()["analysis_id"]))
    analysis.status = "completed"
    analysis.stage = "completed"
    analysis.result = _result()
    analysis.ai_feedback_status = "skipped"
    db.commit()

    @contextmanager
    def same_session():
        yield db

    monkeypatch.setattr(analysis_stream, "SessionLocal", same_session)
    url = f"/analyses/{analysis.id}/events"
    usage_count = db.scalar(
        select(func.count(FeatureUsage.id)).where(FeatureUsage.user_id == user_a)
    )
    assert (
        client.get(url, headers={"Authorization": "Bearer token-a"}).status_code == 200
    )
    assert (
        client.get(url, headers={"Authorization": "Bearer token-a"}).status_code == 200
    )
    assert (
        client.get(url, headers={"Authorization": "Bearer token-b"}).status_code == 404
    )
    assert (
        db.scalar(
            select(func.count(FeatureUsage.id)).where(FeatureUsage.user_id == user_a)
        )
        == usage_count
    )


def test_deleting_analysis_does_not_restore_consumed_usage(
    client: TestClient,
    db: Session,
    auth_analysis_data,
) -> None:
    user_a, _, movement, guide = auth_analysis_data
    created = _reserve(client, user_a, movement, guide, "token-a")
    analysis = db.get(Analysis, uuid.UUID(created.json()["analysis_id"]))
    usage_id = analysis.feature_usage_id
    usage = db.get(FeatureUsage, usage_id)
    usage.status = FeatureUsageStatus.CONSUMED.value
    usage.settled_at = datetime.now(UTC)
    db.commit()

    db.execute(delete(Analysis).where(Analysis.id == analysis.id))
    db.commit()

    retained = db.get(FeatureUsage, usage_id)
    assert retained is not None
    assert retained.status == FeatureUsageStatus.CONSUMED.value


def test_authenticated_media_cleanup_preserves_result_history_and_explanation(
    client: TestClient,
    db: Session,
    auth_analysis_data,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user_a, _, movement, guide = auth_analysis_data
    created = _reserve(client, user_a, movement, guide, "token-a")
    analysis = db.get(Analysis, uuid.UUID(created.json()["analysis_id"]))
    analysis.status = "completed"
    analysis.stage = "completed"
    analysis.video_path = f"analyses/{analysis.id}/source.mp4"
    analysis.video_delete_after = datetime.now(UTC) - timedelta(days=1)
    analysis.result = _result()
    analysis.completed_at = datetime.now(UTC)
    analysis.ai_feedback_status = "completed"
    analysis.ai_explanation = _explanation()
    db.commit()
    bucket = FakeBucket()
    monkeypatch.setattr(
        authenticated_media_cleanup,
        "supabase",
        SimpleNamespace(storage=FakeStorage(bucket)),
    )

    assert cleanup_expired_guest_analyses(db) == 0
    assert cleanup_authenticated_analysis_media(db) == 1
    db.refresh(analysis)
    assert bucket.removed == [[f"analyses/{analysis.id}/source.mp4"]]
    assert analysis.video_path is None
    assert analysis.result == _result()
    assert analysis.ai_explanation == _explanation()
    assert analysis.user_id == user_a
    assert cleanup_authenticated_analysis_media(db) == 0

    app.dependency_overrides[get_current_user_id] = lambda: user_a
    history = client.get("/analyses", headers={"Authorization": "Bearer token-a"})
    assert any(item["analysis_id"] == str(analysis.id) for item in history.json())
    result = client.get(
        f"/analyses/{analysis.id}/result",
        headers={"Authorization": "Bearer token-a"},
    )
    assert result.status_code == 200
    assert result.json()["explanation"] is not None
