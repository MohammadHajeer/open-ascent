from __future__ import annotations

import uuid
from collections.abc import Generator
from datetime import UTC, datetime

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.guest_credentials import hash_guest_token
from app.core.safety import CURRENT_SAFETY_ACK_VERSION
from app.models.analysis import Analysis
from app.models.movement import Movement
from app.models.movement_documentation import MovementDocumentation


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
):
    operation_key = idempotency_key or uuid.uuid4()

    return client.post(
        "/analyses/guest",
        headers={
            "Idempotency-Key": str(operation_key),
        },
        json=reservation_payload(
            movement,
            documentation,
        ),
    )


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
        (f"/analyses/" f"{body['analysis_id']}/status"),
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
        (f"/analyses/" f"{body_b['analysis_id']}/status"),
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
        (f"/analyses/" f"{first_body['analysis_id']}/status"),
        headers={
            "Authorization": (f"Bearer " f"{first_body['credential']}"),
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
        "Idempotency key was already used " "for a different request."
    )
