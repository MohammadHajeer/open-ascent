from __future__ import annotations

import uuid
from contextlib import nullcontext
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session
from storage3.exceptions import StorageApiError

from app.api import analysis_stream
from app.core.config import settings
from app.core.safety import CURRENT_SAFETY_ACK_VERSION
from app.models.analysis import Analysis
from app.models.analysis_event import AnalysisEvent
from app.models.movement import Movement
from app.models.movement_documentation import MovementDocumentation
from app.services import guest_cleanup
from app.services.guest_cleanup import cleanup_expired_guest_analyses


@pytest.fixture
def movement_and_guide(db: Session) -> tuple[Movement, MovementDocumentation]:
    unique = uuid.uuid4().hex[:8]
    movement = Movement(
        slug=f"cleanup-{unique}",
        name=f"Cleanup {unique}",
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
        content={"notice": "Test guidance"},
        published_at=datetime.now(UTC),
    )
    db.add(guide)
    db.commit()
    return movement, guide


def reserve(
    client: TestClient,
    movement: Movement,
    guide: MovementDocumentation,
    key: uuid.UUID | None = None,
):
    return client.post(
        "/analyses/guest",
        headers={"Idempotency-Key": str(key or uuid.uuid4())},
        json={
            "movement_id": str(movement.id),
            "safety_documentation_id": str(guide.id),
            "safety_ack_version": CURRENT_SAFETY_ACK_VERSION,
        },
    )


class FakeBucket:
    def __init__(self) -> None:
        self.removed: list[list[str]] = []

    def remove(self, paths: list[str]) -> list[dict]:
        self.removed.append(paths)
        return []


class FakeStorage:
    def __init__(self, bucket: FakeBucket) -> None:
        self.bucket = bucket

    def from_(self, bucket_name: str) -> FakeBucket:
        assert bucket_name == settings.supabase_video_bucket
        return self.bucket


@pytest.fixture
def bucket(monkeypatch: pytest.MonkeyPatch) -> FakeBucket:
    bucket = FakeBucket()
    monkeypatch.setattr(
        guest_cleanup, "supabase", SimpleNamespace(storage=FakeStorage(bucket))
    )
    return bucket


def test_cleanup_scrubs_expired_guest_and_keeps_statistics(
    client: TestClient,
    db: Session,
    movement_and_guide,
    bucket: FakeBucket,
) -> None:
    movement, guide = movement_and_guide
    first = reserve(client, movement, guide)
    second = reserve(client, movement, guide)
    assert first.status_code == second.status_code == 201
    expired = db.get(Analysis, uuid.UUID(first.json()["analysis_id"]))
    active = db.get(Analysis, uuid.UUID(second.json()["analysis_id"]))
    expired.created_at = datetime.now(UTC) - timedelta(hours=3)
    expired.access_expires_at = datetime.now(UTC) - timedelta(hours=2)
    expired.purge_after = datetime.now(UTC) - timedelta(hours=1)
    expired.video_path = "another-user/path.mp4"  # Must never be trusted for deletion.
    expired.status = "completed"
    expired.stage = "completed"
    expired.result = {
        "outcome": "zero_valid_reps",
        "valid_rep_count": 0,
        "partial_rep_count": 2,
        "uncertain_rep_count": 1,
        "reps": [{"private": "temporary detail"}],
    }
    expired.ai_feedback_status = "completed"
    expired.ai_explanation = {"summary": {"text": "Private coaching"}}
    expired.progress_snapshot = {"private": "progress"}
    expired.error_code = "private_storage_stack_trace"
    db.add(
        AnalysisEvent(
            analysis_id=expired.id,
            attempt=1,
            event_key="test",
            event_type="completed",
            payload={"private": "event"},
        )
    )
    db.commit()

    assert cleanup_expired_guest_analyses(db, batch_size=1) == 1
    db.refresh(expired)
    db.refresh(active)
    assert bucket.removed == [[f"analyses/{expired.id}/source.mp4"]]
    assert active.video_path is None
    assert active.guest_token_hash is not None
    assert expired.id == uuid.UUID(first.json()["analysis_id"])
    assert expired.movement_id == movement.id
    assert expired.created_at is not None
    assert expired.completed_at is not None
    assert expired.terminal_outcome == "zero_valid_reps"
    assert (
        expired.valid_rep_count,
        expired.partial_rep_count,
        expired.uncertain_rep_count,
    ) == (0, 2, 1)
    for name in (
        "video_path",
        "guest_token_hash",
        "guest_rate_key",
        "reservation_operation_key",
        "request_fingerprint",
        "reservation_expires_at",
        "access_expires_at",
        "purge_after",
        "safety_documentation_id",
        "safety_ack_version",
        "safety_acknowledged_at",
        "result",
        "ai_explanation",
        "error_code",
    ):
        assert getattr(expired, name) is None, name
    assert expired.progress_snapshot == {}
    assert expired.guest_cleaned_at is not None
    assert (
        db.scalar(
            select(func.count(AnalysisEvent.id)).where(
                AnalysisEvent.analysis_id == expired.id,
            )
        )
        == 0
    )
    assert cleanup_expired_guest_analyses(db) == 0
    assert bucket.removed == [[f"analyses/{expired.id}/source.mp4"]]


def test_cleanup_skips_active_lease_and_preserves_unexpired_video(
    client: TestClient,
    db: Session,
    movement_and_guide,
    bucket: FakeBucket,
) -> None:
    movement, guide = movement_and_guide
    first = reserve(client, movement, guide)
    second = reserve(client, movement, guide)
    active = db.get(Analysis, uuid.UUID(first.json()["analysis_id"]))
    running = db.get(Analysis, uuid.UUID(second.json()["analysis_id"]))
    active.video_path = f"analyses/{active.id}/source.mp4"
    running.created_at = datetime.now(UTC) - timedelta(hours=3)
    running.access_expires_at = datetime.now(UTC) - timedelta(hours=2)
    running.purge_after = datetime.now(UTC) - timedelta(hours=1)
    running.video_path = f"analyses/{running.id}/source.mp4"
    running.status = "running"
    running.claim_token = uuid.uuid4().hex
    running.lease_expires_at = datetime.now(UTC) + timedelta(minutes=5)
    db.commit()
    assert cleanup_expired_guest_analyses(db) == 0
    assert bucket.removed == []
    assert active.guest_token_hash is not None
    assert running.guest_token_hash is not None


def test_missing_storage_object_is_treated_as_already_deleted(
    client: TestClient,
    db: Session,
    movement_and_guide,
    monkeypatch: pytest.MonkeyPatch,
    bucket: FakeBucket,
) -> None:
    movement, guide = movement_and_guide
    body = reserve(client, movement, guide).json()
    analysis = db.get(Analysis, uuid.UUID(body["analysis_id"]))
    analysis.created_at = datetime.now(UTC) - timedelta(days=2)
    analysis.access_expires_at = datetime.now(UTC) - timedelta(days=1)
    analysis.purge_after = datetime.now(UTC) - timedelta(hours=1)
    db.commit()

    def missing(paths: list[str]) -> None:
        bucket.removed.append(paths)
        raise StorageApiError("Object not found", "NoSuchKey", 404)

    monkeypatch.setattr(bucket, "remove", missing)
    assert cleanup_expired_guest_analyses(db) == 1
    db.refresh(analysis)
    assert analysis.guest_cleaned_at is not None
    assert analysis.status == "expired"


def test_storage_failure_leaves_guest_data_retryable(
    client: TestClient,
    db: Session,
    movement_and_guide,
    monkeypatch: pytest.MonkeyPatch,
    bucket: FakeBucket,
) -> None:
    movement, guide = movement_and_guide
    body = reserve(client, movement, guide).json()
    analysis = db.get(Analysis, uuid.UUID(body["analysis_id"]))
    analysis.created_at = datetime.now(UTC) - timedelta(days=2)
    analysis.access_expires_at = datetime.now(UTC) - timedelta(days=1)
    analysis.purge_after = datetime.now(UTC) - timedelta(hours=1)
    db.commit()

    def unavailable(paths: list[str]) -> None:
        raise StorageApiError("Storage unavailable", "upstream_error", 503)

    monkeypatch.setattr(bucket, "remove", unavailable)
    assert cleanup_expired_guest_analyses(db) == 0
    db.refresh(analysis)
    assert analysis.guest_cleaned_at is None
    assert analysis.guest_token_hash is not None
    assert analysis.access_expires_at is not None


def test_expired_and_wrong_credentials_cannot_access_any_read_route(
    client: TestClient,
    db: Session,
    movement_and_guide,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    movement, guide = movement_and_guide
    first = reserve(client, movement, guide).json()
    second = reserve(client, movement, guide).json()
    monkeypatch.setattr(analysis_stream, "SessionLocal", lambda: nullcontext(db))
    suffixes = ("status", "result", "events")
    for suffix in suffixes:
        url = f"/analyses/{second['analysis_id']}/{suffix}"
        assert client.get(url).status_code == 401
        assert (
            client.get(
                url,
                headers={
                    "Authorization": f"Bearer {first['credential']}",
                },
            ).status_code
            == 401
        )
    analysis = db.get(Analysis, uuid.UUID(second["analysis_id"]))
    analysis.access_expires_at = datetime.now(UTC) - timedelta(seconds=1)
    db.commit()
    for suffix in suffixes:
        assert (
            client.get(
                f"/analyses/{second['analysis_id']}/{suffix}",
                headers={"Authorization": f"Bearer {second['credential']}"},
            ).status_code
            == 401
        )


def test_guest_reservation_limit_and_idempotent_retry(
    client: TestClient,
    db: Session,
    movement_and_guide,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "guest_reservations_per_window", 2)
    movement, guide = movement_and_guide
    key = uuid.uuid4()
    first = reserve(client, movement, guide, key)
    second = reserve(client, movement, guide)
    retry = reserve(client, movement, guide, key)
    denied = reserve(client, movement, guide)
    assert first.status_code == second.status_code == retry.status_code == 201
    assert first.json()["analysis_id"] == retry.json()["analysis_id"]
    assert denied.status_code == 429
    assert (
        db.scalar(
            select(func.count(Analysis.id)).where(
                Analysis.movement_id == movement.id,
            )
        )
        == 2
    )


def test_expired_recent_reservation_still_counts_for_rate_limit(
    client: TestClient,
    db: Session,
    movement_and_guide,
    monkeypatch: pytest.MonkeyPatch,
    bucket: FakeBucket,
) -> None:
    monkeypatch.setattr(settings, "guest_reservations_per_window", 1)
    movement, guide = movement_and_guide
    first = reserve(client, movement, guide)
    analysis = db.get(Analysis, uuid.UUID(first.json()["analysis_id"]))
    analysis.access_expires_at = datetime.now(UTC) - timedelta(seconds=1)
    db.commit()
    assert cleanup_expired_guest_analyses(db) == 0
    assert bucket.removed == []
    assert reserve(client, movement, guide).status_code == 429
