from __future__ import annotations

import uuid
from collections.abc import Generator
from datetime import UTC, datetime

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.safety import CURRENT_SAFETY_ACK_VERSION
from app.models.analysis import Analysis
from app.models.analysis_event import AnalysisEvent
from app.models.movement import Movement
from app.models.movement_documentation import MovementDocumentation
from app.services import analysis_storage
from app.services.analysis_storage import (
    UploadedVideoNotFoundError,
    UploadedVideoTooLongError,
)

# ---------------------------------------------------------------------------
# Test data
# ---------------------------------------------------------------------------


@pytest.fixture
def analysis_test_data(
    db: Session,
) -> Generator[
    tuple[Movement, MovementDocumentation],
    None,
    None,
]:
    unique = uuid.uuid4().hex[:8]

    movement = Movement(
        slug=f"ana-upload-test-{unique}",
        name=f"ANA Upload Test {unique}",
        family_key="ana-upload-test",
        upload_analysis_supported=True,
        live_coach_supported=False,
    )

    db.add(movement)
    db.flush()

    documentation = MovementDocumentation(
        movement_id=movement.id,
        version=1,
        status="published",
        content={
            "notice": "ANA-02 test safety documentation.",
        },
        published_at=datetime.now(UTC),
    )

    db.add(documentation)
    db.commit()

    db.refresh(movement)
    db.refresh(documentation)

    yield movement, documentation

    db.execute(delete(Analysis).where(Analysis.movement_id == movement.id))

    db.execute(
        delete(MovementDocumentation).where(
            MovementDocumentation.movement_id == movement.id
        )
    )

    db.execute(delete(Movement).where(Movement.id == movement.id))

    db.commit()


# ---------------------------------------------------------------------------
# Fake Supabase Storage
# ---------------------------------------------------------------------------


class FakeBucket:
    def __init__(self) -> None:
        self.signed_paths: list[str] = []

    def create_signed_upload_url(
        self,
        path: str,
    ) -> dict[str, str]:
        self.signed_paths.append(path)

        return {
            "token": "test-signed-upload-token",
        }


class FakeStorage:
    def __init__(
        self,
        bucket: FakeBucket,
    ) -> None:
        self.bucket = bucket
        self.requested_bucket: str | None = None

    def from_(
        self,
        bucket_name: str,
    ) -> FakeBucket:
        self.requested_bucket = bucket_name
        return self.bucket


class FakeSupabase:
    def __init__(
        self,
        storage: FakeStorage,
    ) -> None:
        self.storage = storage


@pytest.fixture
def fake_storage(
    monkeypatch: pytest.MonkeyPatch,
) -> tuple[FakeBucket, FakeStorage]:
    bucket = FakeBucket()
    storage = FakeStorage(bucket)

    monkeypatch.setattr(
        analysis_storage,
        "supabase",
        FakeSupabase(storage),
    )

    return bucket, storage


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def reservation_payload(
    movement: Movement,
    documentation: MovementDocumentation,
) -> dict[str, str]:
    return {
        "movement_id": str(movement.id),
        "safety_documentation_id": str(documentation.id),
        "safety_ack_version": (CURRENT_SAFETY_ACK_VERSION),
    }


def create_reservation(
    client: TestClient,
    movement: Movement,
    documentation: MovementDocumentation,
):
    return client.post(
        "/analyses/guest",
        headers={
            "Idempotency-Key": str(uuid.uuid4()),
        },
        json=reservation_payload(
            movement,
            documentation,
        ),
    )


# ---------------------------------------------------------------------------
# Upload authorization
# ---------------------------------------------------------------------------


def test_upload_authorization_uses_exact_reserved_path(
    client: TestClient,
    analysis_test_data: tuple[
        Movement,
        MovementDocumentation,
    ],
    fake_storage: tuple[
        FakeBucket,
        FakeStorage,
    ],
) -> None:
    movement, documentation = analysis_test_data
    bucket, storage = fake_storage

    reservation = create_reservation(
        client,
        movement,
        documentation,
    )

    assert reservation.status_code == 201

    reservation_body = reservation.json()

    analysis_id = reservation_body["analysis_id"]

    response = client.post(
        f"/analyses/{analysis_id}/upload",
        headers={
            "Authorization": (f"Bearer " f"{reservation_body['credential']}"),
        },
    )

    assert response.status_code == 200

    body = response.json()

    expected_path = f"analyses/{analysis_id}/source.mp4"

    assert body["analysis_id"] == analysis_id
    assert body["path"] == expected_path
    assert body["bucket"] == settings.supabase_video_bucket
    assert body["token"] == "test-signed-upload-token"

    assert body["max_size_bytes"] == (settings.guest_video_max_size_mb * 1024 * 1024)

    assert body["allowed_content_types"] == ["video/mp4"]

    # Supabase was asked to sign only this exact path.
    assert bucket.signed_paths == [expected_path]

    assert storage.requested_bucket == settings.supabase_video_bucket


def test_upload_authorization_requires_guest_credential(
    client: TestClient,
    analysis_test_data: tuple[
        Movement,
        MovementDocumentation,
    ],
) -> None:
    movement, documentation = analysis_test_data

    reservation = create_reservation(
        client,
        movement,
        documentation,
    )

    assert reservation.status_code == 201

    analysis_id = reservation.json()["analysis_id"]

    response = client.post(f"/analyses/{analysis_id}/upload")

    assert response.status_code == 401


def test_credential_cannot_authorize_upload_for_another_analysis(
    client: TestClient,
    analysis_test_data: tuple[
        Movement,
        MovementDocumentation,
    ],
) -> None:
    movement, documentation = analysis_test_data

    first = create_reservation(
        client,
        movement,
        documentation,
    )

    second = create_reservation(
        client,
        movement,
        documentation,
    )

    assert first.status_code == 201
    assert second.status_code == 201

    first_body = first.json()
    second_body = second.json()

    response = client.post(
        (f"/analyses/" f"{second_body['analysis_id']}/upload"),
        headers={
            "Authorization": (f"Bearer " f"{first_body['credential']}"),
        },
    )

    assert response.status_code == 401


# ---------------------------------------------------------------------------
# Finalization
# ---------------------------------------------------------------------------


def test_finalize_rejects_missing_video(
    client: TestClient,
    analysis_test_data: tuple[
        Movement,
        MovementDocumentation,
    ],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    movement, documentation = analysis_test_data

    reservation = create_reservation(
        client,
        movement,
        documentation,
    )

    assert reservation.status_code == 201

    body = reservation.json()

    def missing_video(
        path: str,
    ) -> bytes:
        raise UploadedVideoNotFoundError

    monkeypatch.setattr(
        analysis_storage,
        "_download_uploaded_video",
        missing_video,
    )

    response = client.post(
        (f"/analyses/" f"{body['analysis_id']}/finalize"),
        headers={
            "Authorization": (f"Bearer {body['credential']}"),
        },
    )

    assert response.status_code == 409


def test_valid_video_finalization_queues_analysis(
    client: TestClient,
    db: Session,
    analysis_test_data: tuple[
        Movement,
        MovementDocumentation,
    ],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    movement, documentation = analysis_test_data

    reservation = create_reservation(
        client,
        movement,
        documentation,
    )

    assert reservation.status_code == 201

    body = reservation.json()

    monkeypatch.setattr(
        analysis_storage,
        "_download_uploaded_video",
        lambda path: b"test-video-bytes",
    )

    monkeypatch.setattr(
        analysis_storage,
        "_validate_video_bytes",
        lambda video_bytes: None,
    )

    response = client.post(
        (f"/analyses/" f"{body['analysis_id']}/finalize"),
        headers={
            "Authorization": (f"Bearer {body['credential']}"),
        },
    )

    assert response.status_code == 200

    response_body = response.json()

    expected_path = f"analyses/" f"{body['analysis_id']}/source.mp4"

    assert response_body["status"] == "queued"
    assert response_body["stage"] == "queued"
    assert response_body["video_path"] == expected_path

    analysis = db.get(
        Analysis,
        uuid.UUID(body["analysis_id"]),
    )

    assert analysis is not None
    assert analysis.status == "queued"
    assert analysis.stage == "queued"
    assert analysis.video_path == expected_path


def test_finalize_retry_is_idempotent(
    client: TestClient,
    db: Session,
    analysis_test_data: tuple[
        Movement,
        MovementDocumentation,
    ],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    movement, documentation = analysis_test_data

    reservation = create_reservation(
        client,
        movement,
        documentation,
    )

    assert reservation.status_code == 201

    body = reservation.json()

    download_count = 0

    def download_video(
        path: str,
    ) -> bytes:
        nonlocal download_count
        download_count += 1
        return b"test-video-bytes"

    monkeypatch.setattr(
        analysis_storage,
        "_download_uploaded_video",
        download_video,
    )

    monkeypatch.setattr(
        analysis_storage,
        "_validate_video_bytes",
        lambda video_bytes: None,
    )

    url = f"/analyses/" f"{body['analysis_id']}/finalize"

    headers = {
        "Authorization": (f"Bearer {body['credential']}"),
    }

    first = client.post(
        url,
        headers=headers,
    )

    second = client.post(
        url,
        headers=headers,
    )

    assert first.status_code == 200
    assert second.status_code == 200

    assert first.json() == second.json()

    # The retry returns the already-finalized analysis
    # instead of processing the uploaded object again.
    assert download_count == 1
    analysis_id = uuid.UUID(body["analysis_id"])
    assert db.scalar(
        select(func.count(AnalysisEvent.id)).where(
            AnalysisEvent.analysis_id == analysis_id,
            AnalysisEvent.event_type == "analysis_queued",
        )
    ) == 1
    assert db.get(Analysis, analysis_id).attempts == 0


def test_finalize_rejects_invalid_state_without_queueing_again(
    client: TestClient,
    db: Session,
    analysis_test_data: tuple[Movement, MovementDocumentation],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    movement, documentation = analysis_test_data
    reservation = create_reservation(client, movement, documentation)
    body = reservation.json()
    analysis = db.get(Analysis, uuid.UUID(body["analysis_id"]))
    analysis.status = "failed"
    db.commit()
    monkeypatch.setattr(
        analysis_storage, "_download_uploaded_video",
        lambda path: pytest.fail("Invalid state must not download or enqueue."),
    )
    response = client.post(
        f"/analyses/{analysis.id}/finalize",
        headers={"Authorization": f"Bearer {body['credential']}"},
    )
    assert response.status_code == 409
    assert db.scalar(select(func.count(AnalysisEvent.id)).where(
        AnalysisEvent.analysis_id == analysis.id,
    )) == 0


def test_invalid_video_is_rejected(
    client: TestClient,
    analysis_test_data: tuple[
        Movement,
        MovementDocumentation,
    ],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    movement, documentation = analysis_test_data

    reservation = create_reservation(
        client,
        movement,
        documentation,
    )

    assert reservation.status_code == 201

    body = reservation.json()

    monkeypatch.setattr(
        analysis_storage,
        "_download_uploaded_video",
        lambda path: b"this-is-not-an-mp4",
    )

    response = client.post(
        (f"/analyses/" f"{body['analysis_id']}/finalize"),
        headers={
            "Authorization": (f"Bearer {body['credential']}"),
        },
    )

    assert response.status_code == 415


def test_oversized_video_is_rejected(
    client: TestClient,
    analysis_test_data: tuple[
        Movement,
        MovementDocumentation,
    ],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    movement, documentation = analysis_test_data

    reservation = create_reservation(
        client,
        movement,
        documentation,
    )

    assert reservation.status_code == 201

    body = reservation.json()

    monkeypatch.setattr(settings, "guest_video_max_size_mb", 0)
    monkeypatch.setattr(
        analysis_storage, "_download_uploaded_video",
        lambda path: b"0" * 13,
    )

    response = client.post(
        (f"/analyses/" f"{body['analysis_id']}/finalize"),
        headers={
            "Authorization": (f"Bearer {body['credential']}"),
        },
    )

    assert response.status_code == 413


def test_too_long_video_is_rejected(
    client: TestClient,
    analysis_test_data: tuple[
        Movement,
        MovementDocumentation,
    ],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    movement, documentation = analysis_test_data

    reservation = create_reservation(
        client,
        movement,
        documentation,
    )

    assert reservation.status_code == 201

    body = reservation.json()

    monkeypatch.setattr(
        analysis_storage,
        "_download_uploaded_video",
        lambda path: b"video",
    )

    def reject_duration(
        video_bytes: bytes,
    ) -> None:
        raise UploadedVideoTooLongError

    monkeypatch.setattr(
        analysis_storage,
        "_validate_video_bytes",
        reject_duration,
    )

    response = client.post(
        (f"/analyses/" f"{body['analysis_id']}/finalize"),
        headers={
            "Authorization": (f"Bearer {body['credential']}"),
        },
    )

    assert response.status_code == 422
