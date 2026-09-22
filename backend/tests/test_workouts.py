from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

from app.api.dependencies.auth import get_current_user_id
from app.main import app
from app.models.analysis import Analysis
from app.models.movement import Movement
from app.models.movement_documentation import MovementDocumentation
from app.models.profile import Profile
from app.models.training import WorkoutSession, WorkoutSet


@pytest.fixture
def workout_data(db: Session):
    user_a, user_b = uuid.uuid4(), uuid.uuid4()
    for user_id in (user_a, user_b):
        db.execute(text("INSERT INTO auth.users (id) VALUES (:id)"), {"id": user_id})
        db.add(
            Profile(
                id=user_id,
                display_name="Workout athlete",
                app_role="athlete",
                athlete_state={"marker": str(user_id)},
            )
        )
    movement = Movement(
        slug=f"workout-{uuid.uuid4().hex[:8]}",
        name="Test Pull-Up",
        family_key="vertical_pull",
        upload_analysis_supported=True,
        live_coach_supported=True,
    )
    db.add(movement)
    db.flush()
    guide = MovementDocumentation(
        movement_id=movement.id,
        version=1,
        status="published",
        content={"notice": "Test safely."},
        published_at=datetime.now(UTC),
    )
    db.add(guide)
    db.flush()

    analyses: dict[uuid.UUID, Analysis] = {}
    for user_id in (user_a, user_b):
        analysis = Analysis(
            user_id=user_id,
            movement_id=movement.id,
            safety_documentation_id=guide.id,
            safety_ack_version="test-v1",
            safety_acknowledged_at=datetime.now(UTC),
            owner_kind="authenticated",
            status="completed",
            stage="completed",
            reservation_operation_key=str(uuid.uuid4()),
            request_fingerprint=uuid.uuid4().hex,
            reservation_expires_at=datetime.now(UTC) + timedelta(minutes=10),
            completed_at=datetime.now(UTC),
        )
        db.add(analysis)
        analyses[user_id] = analysis
    db.commit()
    yield user_a, user_b, movement, analyses
    app.dependency_overrides.pop(get_current_user_id, None)


def _auth(user_id: uuid.UUID) -> dict[str, str]:
    app.dependency_overrides[get_current_user_id] = lambda: user_id
    return {"Authorization": "Bearer test-token"}


def _start(client: TestClient, user_id: uuid.UUID):
    return client.post("/workout-sessions", headers=_auth(user_id), json={})


def _set_payload(movement: Movement, **changes):
    return {
        "movement_id": str(movement.id),
        "position": 0,
        "source": "manual",
        "performer": "self",
        "intent": "training_set",
        "reps": 8,
    } | changes


def test_create_list_detail_finish_are_owner_scoped(
    client: TestClient,
    db: Session,
    workout_data,
):
    user_a, user_b, movement, _ = workout_data
    before_state = dict(db.get(Profile, user_a).athlete_state)
    created = _start(client, user_a)
    assert created.status_code == 201
    session_id = created.json()["id"]

    added = client.post(
        f"/workout-sessions/{session_id}/sets",
        headers=_auth(user_a),
        json=_set_payload(movement),
    )
    assert added.status_code == 201
    assert added.json()["reps"] == 8
    assert added.json()["hold_seconds"] is None

    detail = client.get(f"/workout-sessions/{session_id}", headers=_auth(user_a))
    assert detail.status_code == 200
    assert detail.json()["sets"][0]["movement_id"] == str(movement.id)
    assert len(client.get("/workout-sessions", headers=_auth(user_a)).json()) == 1
    assert client.get("/workout-sessions", headers=_auth(user_b)).json() == []
    assert (
        client.get(f"/workout-sessions/{session_id}", headers=_auth(user_b)).status_code
        == 404
    )
    assert (
        client.post(
            f"/workout-sessions/{session_id}/sets",
            headers=_auth(user_b),
            json=_set_payload(movement, position=1),
        ).status_code
        == 404
    )

    finished = client.post(
        f"/workout-sessions/{session_id}/finish",
        headers=_auth(user_a),
        json={"notes": "Strong session"},
    )
    assert finished.status_code == 200
    assert finished.json()["completed_at"] is not None
    assert finished.json()["notes"] == "Strong session"
    db.refresh(db.get(Profile, user_a))
    assert db.get(Profile, user_a).athlete_state == before_state


def test_rep_hold_and_invalid_measurements(
    client: TestClient,
    workout_data,
):
    user_a, _, movement, _ = workout_data
    session_id = _start(client, user_a).json()["id"]
    hold = client.post(
        f"/workout-sessions/{session_id}/sets",
        headers=_auth(user_a),
        json=_set_payload(movement, position=1, reps=None, hold_seconds=12.5),
    )
    assert hold.status_code == 201
    assert hold.json()["hold_seconds"] == "12.500"
    for payload in (
        _set_payload(movement, position=2, reps=None),
        _set_payload(movement, position=3, hold_seconds=2),
        _set_payload(movement, position=4, reps=0),
    ):
        assert (
            client.post(
                f"/workout-sessions/{session_id}/sets",
                headers=_auth(user_a),
                json=payload,
            ).status_code
            == 422
        )


def test_non_analysis_sources(
    client: TestClient,
    workout_data,
):
    user_a, _, movement, _ = workout_data
    session_id = _start(client, user_a).json()["id"]
    sources = [
        ("manual", {}),
        ("self_reported", {}),
        ("live_coach", {"live_coach_session_ref": "browser-session-1"}),
    ]
    for position, (source, extra) in enumerate(sources):
        response = client.post(
            f"/workout-sessions/{session_id}/sets",
            headers=_auth(user_a),
            json=_set_payload(movement, position=position, source=source, **extra),
        )
        assert response.status_code == 201
        assert response.json()["source"] == source


def test_performer_and_intent_values(
    client: TestClient,
    workout_data,
):
    user_a, _, movement, _ = workout_data
    session_id = _start(client, user_a).json()["id"]
    performers = ["self", "other", "unknown"]
    intents = ["training_set", "assessment", "max_test", "skill_attempt"]
    position = 0
    for performer in performers:
        for intent in intents:
            response = client.post(
                f"/workout-sessions/{session_id}/sets",
                headers=_auth(user_a),
                json=_set_payload(
                    movement,
                    position=position,
                    performer=performer,
                    intent=intent,
                ),
            )
            assert response.status_code == 201
            assert response.json()["performer"] == performer
            assert response.json()["intent"] == intent
            position += 1


def test_uploaded_analysis_must_be_completed_owned_and_match_movement(
    client: TestClient,
    db: Session,
    workout_data,
):
    user_a, user_b, movement, analyses = workout_data
    session_id = _start(client, user_a).json()["id"]
    own = client.post(
        f"/workout-sessions/{session_id}/sets",
        headers=_auth(user_a),
        json=_set_payload(
            movement,
            source="uploaded_analysis",
            analysis_id=str(analyses[user_a].id),
        ),
    )
    assert own.status_code == 201
    assert own.json()["analysis_id"] == str(analyses[user_a].id)

    other_session_id = _start(client, user_a).json()["id"]
    cross_user = client.post(
        f"/workout-sessions/{other_session_id}/sets",
        headers=_auth(user_a),
        json=_set_payload(
            movement,
            source="uploaded_analysis",
            analysis_id=str(analyses[user_b].id),
        ),
    )
    assert cross_user.status_code == 422

    random_analysis = Analysis(
        user_id=user_a,
        movement_id=movement.id,
        safety_documentation_id=analyses[user_a].safety_documentation_id,
        safety_ack_version="test-v1",
        safety_acknowledged_at=datetime.now(UTC),
        owner_kind="authenticated",
        status="completed",
        stage="completed",
        reservation_operation_key=str(uuid.uuid4()),
        request_fingerprint=uuid.uuid4().hex,
        reservation_expires_at=datetime.now(UTC) + timedelta(minutes=10),
        completed_at=datetime.now(UTC),
    )
    db.add(random_analysis)
    db.commit()
    assert db.scalar(
        select(func.count()).select_from(WorkoutSet).where(
            WorkoutSet.analysis_id == random_analysis.id
        )
    ) == 0


def test_update_set_keeps_measurement_unambiguous(client: TestClient, workout_data):
    user_a, _, movement, _ = workout_data
    session_id = _start(client, user_a).json()["id"]
    created = client.post(
        f"/workout-sessions/{session_id}/sets",
        headers=_auth(user_a),
        json=_set_payload(movement),
    ).json()
    invalid = client.patch(
        f"/workout-sessions/{session_id}/sets/{created['id']}",
        headers=_auth(user_a),
        json={"hold_seconds": 10},
    )
    assert invalid.status_code == 422
    updated = client.patch(
        f"/workout-sessions/{session_id}/sets/{created['id']}",
        headers=_auth(user_a),
        json={"reps": 9, "performer": "unknown"},
    )
    assert updated.status_code == 200
    assert updated.json()["reps"] == 9
    assert updated.json()["performer"] == "unknown"


def test_analysis_creation_does_not_create_workout_session(
    db: Session,
    workout_data,
):
    user_a, _, _, _ = workout_data
    assert db.scalar(
        select(func.count()).select_from(WorkoutSession).where(
            WorkoutSession.user_id == user_a
        )
    ) == 0
