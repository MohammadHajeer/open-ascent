from __future__ import annotations

import uuid
from collections.abc import Generator
from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.guest_credentials import hash_guest_token
from app.core.safety import CURRENT_SAFETY_ACK_VERSION
from app.models.analysis import Analysis
from app.models.guest_analysis_usage import GuestAnalysisUsage
from app.models.movement import Movement
from app.models.movement_documentation import MovementDocumentation
from app.services import analysis as analysis_service


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
        slug=f"ana-test-{unique}",
        name=f"ANA Test Movement {unique}",
        family_key="ana-test",
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
            "notice": "ANA-01 test safety documentation.",
        },
        published_at=datetime.now(UTC),
    )

    db.add(documentation)
    db.commit()

    db.refresh(movement)
    db.refresh(documentation)

    yield movement, documentation

    # Analyses must be removed before their parent records.
    db.execute(delete(Analysis).where(Analysis.movement_id == movement.id))

    db.execute(
        delete(MovementDocumentation).where(
            MovementDocumentation.movement_id == movement.id
        )
    )

    db.execute(delete(Movement).where(Movement.id == movement.id))

    db.commit()


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
    *,
    idempotency_key: uuid.UUID | None = None,
    guest_credential: str | None = None,
):
    operation_key = idempotency_key or uuid.uuid4()

    return client.post(
        "/analyses/guest",
        headers={
            "Idempotency-Key": str(operation_key),
            **({"Guest-Credential": guest_credential} if guest_credential else {}),
        },
        json=reservation_payload(
            movement,
            documentation,
        ),
    )


def test_same_guest_credential_is_limited_to_one_analysis_per_utc_day(
    client: TestClient,
    analysis_test_data: tuple[Movement, MovementDocumentation],
) -> None:
    movement, documentation = analysis_test_data
    first = create_reservation(client, movement, documentation)
    assert first.status_code == 201

    second = create_reservation(
        client,
        movement,
        documentation,
        guest_credential=first.json()["credential"],
    )

    assert second.status_code == 429
    assert second.json()["error"]["message"] == (
        "Guests can analyze one video per day. Sign in to continue analyzing."
    )


def test_same_guest_credential_can_analyze_after_utc_day_changes(
    client: TestClient,
    analysis_test_data: tuple[Movement, MovementDocumentation],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    movement, documentation = analysis_test_data
    first_day = datetime(2098, 1, 1, 23, 59, tzinfo=UTC)
    monkeypatch.setattr(analysis_service, "_utc_now", lambda: first_day)
    monkeypatch.setattr(settings, "guest_reservations_per_window", 200)
    first = create_reservation(client, movement, documentation)
    assert first.status_code == 201

    monkeypatch.setattr(
        analysis_service,
        "_utc_now",
        lambda: first_day + timedelta(minutes=2),
    )
    second = create_reservation(
        client,
        movement,
        documentation,
        guest_credential=first.json()["credential"],
    )

    assert second.status_code == 201, second.text


def test_global_guest_daily_capacity_accepts_100_and_rejects_101st(
    client: TestClient,
    db: Session,
    analysis_test_data: tuple[Movement, MovementDocumentation],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    movement, documentation = analysis_test_data
    monkeypatch.setattr(
        analysis_service,
        "_utc_now",
        lambda: datetime(2098, 2, 1, 12, tzinfo=UTC),
    )
    monkeypatch.setattr(settings, "guest_reservations_per_window", 200)

    first = create_reservation(client, movement, documentation)
    assert first.status_code == 201
    template = db.get(Analysis, uuid.UUID(first.json()["analysis_id"]))
    assert template is not None
    for index in range(99):
        analysis = Analysis(
            movement_id=movement.id,
            family_key=movement.family_key,
            safety_documentation_id=documentation.id,
            safety_ack_version=CURRENT_SAFETY_ACK_VERSION,
            safety_acknowledged_at=datetime(2098, 2, 1, 12, tzinfo=UTC),
            owner_kind="guest",
            status="reserved",
            stage="reserved",
            guest_token_hash=f"identity-{index}",
            guest_rate_key=f"rate-{index}",
            reservation_operation_key=str(uuid.uuid4()),
            request_fingerprint=f"fingerprint-{index}",
            reservation_expires_at=datetime(2098, 2, 1, 13, tzinfo=UTC),
            access_expires_at=datetime(2098, 2, 1, 13, tzinfo=UTC),
            purge_after=datetime(2098, 2, 2, 12, tzinfo=UTC),
        )
        db.add(analysis)
        db.flush()
        db.add(
            GuestAnalysisUsage(
                analysis_id=analysis.id,
                usage_date=datetime(2098, 2, 1, tzinfo=UTC).date(),
                guest_identity_key=f"identity-{index}",
            )
        )
    db.commit()

    assert db.scalar(
        select(func.count(GuestAnalysisUsage.id)).where(
            GuestAnalysisUsage.usage_date == datetime(2098, 2, 1, tzinfo=UTC).date()
        )
    ) == 100
    rejected = create_reservation(client, movement, documentation)
    assert rejected.status_code == 429
    assert rejected.json()["error"]["message"] == (
        "Guest analysis capacity has been reached for today. "
        "Sign in to continue analyzing."
    )


def test_idempotent_retry_of_accepted_analysis_does_not_double_charge(
    client: TestClient,
    db: Session,
    analysis_test_data: tuple[Movement, MovementDocumentation],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    movement, documentation = analysis_test_data
    monkeypatch.setattr(settings, "guest_global_daily_limit", 1)
    operation_key = uuid.uuid4()
    first = create_reservation(
        client, movement, documentation, idempotency_key=operation_key
    )
    accepted = db.get(Analysis, uuid.UUID(first.json()["analysis_id"]))
    accepted.status = "failed"
    accepted.stage = "failed"
    accepted.failed_at = datetime.now(UTC)
    db.commit()
    retry = create_reservation(
        client, movement, documentation, idempotency_key=operation_key
    )

    assert first.status_code == retry.status_code == 201
    assert first.json()["analysis_id"] == retry.json()["analysis_id"]
    assert db.scalar(
        select(func.count(GuestAnalysisUsage.id)).where(
            GuestAnalysisUsage.guest_identity_key == accepted.guest_token_hash
        )
    ) == 1
    rejected = create_reservation(client, movement, documentation)
    assert rejected.status_code == 429


def test_safety_guide_remains_available_when_guest_capacity_is_exhausted(
    client: TestClient,
    analysis_test_data: tuple[Movement, MovementDocumentation],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    movement, documentation = analysis_test_data
    monkeypatch.setattr(settings, "guest_global_daily_limit", 1)
    assert create_reservation(client, movement, documentation).status_code == 201
    assert create_reservation(client, movement, documentation).status_code == 429

    guide = client.get(f"/movements/{movement.slug}")
    assert guide.status_code == 200
    assert guide.json()["documentation"]["id"] == str(documentation.id)


def test_any_vertical_pull_reservation_has_no_specific_movement_target(
    client: TestClient,
    db: Session,
) -> None:
    movement = db.scalar(select(Movement).where(Movement.slug == "pull-up"))
    created_movement = movement is None
    if movement is None:
        movement = Movement(
            slug="pull-up",
            name="Pull-Up",
            family_key="vertical_pull",
            upload_analysis_supported=True,
            live_coach_supported=False,
        )
        db.add(movement)
        db.flush()
    documentation = db.scalar(
        select(MovementDocumentation).where(
            MovementDocumentation.movement_id == movement.id,
            MovementDocumentation.status == "published",
        )
    )
    created_documentation = documentation is None
    if documentation is None:
        documentation = MovementDocumentation(
            movement_id=movement.id,
            version=1,
            status="published",
            content={"notice": "Use a stable bar."},
            published_at=datetime.now(UTC),
        )
        db.add(documentation)
        db.flush()
    db.commit()

    response = client.post(
        "/analyses/guest",
        headers={"Idempotency-Key": str(uuid.uuid4())},
        json={
            "family_key": "vertical_pull",
            "safety_documentation_id": str(documentation.id),
            "safety_ack_version": CURRENT_SAFETY_ACK_VERSION,
        },
    )
    assert response.status_code == 201, response.text
    analysis_id = uuid.UUID(response.json()["analysis_id"])
    analysis = db.get(Analysis, analysis_id)
    assert analysis.movement_id is None
    assert analysis.family_key == "vertical_pull"
    assert analysis.safety_documentation_id == documentation.id
    result = client.get(
        f"/analyses/{analysis_id}/result",
        headers={"Authorization": f"Bearer {response.json()['credential']}"},
    )
    assert result.status_code == 200
    assert result.json()["movement"]["name"] == "Any Vertical Pull"
    assert result.json()["movement"]["id"] is None

    db.execute(delete(Analysis).where(Analysis.id == analysis_id))
    if created_documentation:
        db.execute(
            delete(MovementDocumentation).where(
                MovementDocumentation.id == documentation.id
            )
        )
    if created_movement:
        db.execute(delete(Movement).where(Movement.id == movement.id))
    db.commit()


def test_guest_reservation_creates_analysis_and_credential(
    client: TestClient,
    db: Session,
    analysis_test_data: tuple[
        Movement,
        MovementDocumentation,
    ],
) -> None:
    movement, documentation = analysis_test_data

    response = create_reservation(
        client,
        movement,
        documentation,
    )

    assert response.status_code == 201, response.text

    body = response.json()

    assert body["status"] == "reserved"
    assert body["credential_type"] == "Bearer"
    assert body["credential"].startswith("oa_guest_")

    analysis_id = uuid.UUID(body["analysis_id"])

    analysis = db.get(
        Analysis,
        analysis_id,
    )

    assert analysis is not None
    assert analysis.movement_id == movement.id
    assert analysis.owner_kind == "guest"
    assert analysis.status == "reserved"
    assert analysis.stage == "reserved"

    # The raw credential must never be stored.
    assert analysis.guest_token_hash != body["credential"]

    # The stored hash must correspond to the
    # returned credential.
    assert analysis.guest_token_hash == (
        hash_guest_token(
            body["credential"],
            settings.guest_token_secret,
        )
    )


def test_analysis_id_alone_does_not_authorize_access(
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

    response = client.get(f"/analyses/{analysis_id}/status")

    assert response.status_code == 401


def test_wrong_guest_credential_is_rejected(
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

    response = client.get(
        f"/analyses/{analysis_id}/status",
        headers={
            "Authorization": ("Bearer oa_guest_wrong-token"),
        },
    )

    assert response.status_code == 401


def test_correct_guest_credential_allows_access(
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

    body = reservation.json()

    response = client.get(
        (f"/analyses/{body['analysis_id']}/status"),
        headers={
            "Authorization": (f"Bearer {body['credential']}"),
        },
    )

    assert response.status_code == 200

    status_body = response.json()

    assert status_body["analysis_id"] == body["analysis_id"]

    assert status_body["status"] == "reserved"
    assert status_body["stage"] == "reserved"


def test_credential_cannot_access_another_analysis(
    client: TestClient,
    analysis_test_data: tuple[
        Movement,
        MovementDocumentation,
    ],
) -> None:
    movement, documentation = analysis_test_data

    reservation_a = create_reservation(
        client,
        movement,
        documentation,
    )

    reservation_b = create_reservation(
        client,
        movement,
        documentation,
    )

    assert reservation_a.status_code == 201
    assert reservation_b.status_code == 201

    body_a = reservation_a.json()
    body_b = reservation_b.json()

    response = client.get(
        (f"/analyses/{body_b['analysis_id']}/status"),
        headers={
            "Authorization": (f"Bearer {body_a['credential']}"),
        },
    )

    assert response.status_code == 401


def test_same_idempotency_key_reuses_same_analysis(
    client: TestClient,
    analysis_test_data: tuple[
        Movement,
        MovementDocumentation,
    ],
) -> None:
    movement, documentation = analysis_test_data

    operation_key = uuid.uuid4()

    first = create_reservation(
        client,
        movement,
        documentation,
        idempotency_key=operation_key,
    )

    second = create_reservation(
        client,
        movement,
        documentation,
        idempotency_key=operation_key,
    )

    assert first.status_code == 201
    assert second.status_code == 201

    first_body = first.json()
    second_body = second.json()

    # Same logical reservation.
    assert first_body["analysis_id"] == second_body["analysis_id"]

    # A retry must return the same guest credential.
    assert first_body["credential"] == second_body["credential"]

    # Idempotent retries must not extend either
    # expiration timestamp.
    assert first_body["reservation_expires_at"] == second_body["reservation_expires_at"]

    assert first_body["access_expires_at"] == second_body["access_expires_at"]


def test_idempotent_retry_keeps_original_credential_valid(
    client: TestClient,
    analysis_test_data: tuple[
        Movement,
        MovementDocumentation,
    ],
) -> None:
    movement, documentation = analysis_test_data

    operation_key = uuid.uuid4()

    first = create_reservation(
        client,
        movement,
        documentation,
        idempotency_key=operation_key,
    )

    second = create_reservation(
        client,
        movement,
        documentation,
        idempotency_key=operation_key,
    )

    assert first.status_code == 201
    assert second.status_code == 201

    first_body = first.json()
    second_body = second.json()

    assert first_body["credential"] == second_body["credential"]

    response = client.get(
        (f"/analyses/{first_body['analysis_id']}/status"),
        headers={
            "Authorization": (f"Bearer {first_body['credential']}"),
        },
    )

    assert response.status_code == 200


def test_same_idempotency_key_with_different_request_is_rejected(
    client: TestClient,
    analysis_test_data: tuple[
        Movement,
        MovementDocumentation,
    ],
) -> None:
    movement, documentation = analysis_test_data

    operation_key = uuid.uuid4()

    first = create_reservation(
        client,
        movement,
        documentation,
        idempotency_key=operation_key,
    )

    assert first.status_code == 201

    changed_payload = reservation_payload(
        movement,
        documentation,
    )

    changed_payload["safety_ack_version"] = "different-version"

    second = client.post(
        "/analyses/guest",
        headers={
            "Idempotency-Key": str(operation_key),
        },
        json=changed_payload,
    )

    assert second.status_code == 409

    body = second.json()

    assert body["error"]["code"] == "http_error"

    assert body["error"]["message"] == (
        "Idempotency key was already used for a different request."
    )
