from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from decimal import Decimal

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.api.dependencies.auth import get_current_user_id
from app.main import app
from app.models.analysis import Analysis
from app.models.movement import Movement
from app.models.movement_documentation import MovementDocumentation
from app.models.profile import Profile
from app.models.training import WorkoutSession, WorkoutSet


@pytest.fixture
def progress_data(db: Session):
    user_a, user_b = uuid.uuid4(), uuid.uuid4()
    for user_id in (user_a, user_b):
        db.execute(text("INSERT INTO auth.users (id) VALUES (:id)"), {"id": user_id})
        db.add(
            Profile(
                id=user_id,
                display_name="Progress athlete",
                app_role="athlete",
                athlete_state={},
            )
        )
    pull_up = Movement(
        slug=f"progress-pull-up-{uuid.uuid4().hex[:8]}",
        name="Progress Pull-Up",
        family_key="vertical_pull",
        upload_analysis_supported=True,
        live_coach_supported=True,
    )
    front_lever = Movement(
        slug=f"progress-front-lever-{uuid.uuid4().hex[:8]}",
        name="Progress Front Lever",
        family_key="static_hold",
        upload_analysis_supported=False,
        live_coach_supported=False,
    )
    db.add_all([pull_up, front_lever])
    db.flush()
    guide = MovementDocumentation(
        movement_id=pull_up.id,
        version=1,
        status="published",
        content={"notice": "Test safely."},
        published_at=datetime.now(UTC),
    )
    db.add(guide)
    db.flush()
    analysis = Analysis(
        user_id=user_a,
        movement_id=pull_up.id,
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
    db.commit()
    yield user_a, user_b, pull_up, front_lever, analysis
    app.dependency_overrides.pop(get_current_user_id, None)


def _auth(user_id: uuid.UUID) -> dict[str, str]:
    app.dependency_overrides[get_current_user_id] = lambda: user_id
    return {"Authorization": "Bearer test-token"}


def _add_set(
    db: Session,
    user_id: uuid.UUID,
    movement: Movement,
    *,
    started_at: datetime,
    reps: int | None = None,
    hold_seconds: Decimal | None = None,
    performer: str = "self",
    source: str = "manual",
    intent: str = "training_set",
    analysis_id: uuid.UUID | None = None,
) -> WorkoutSet:
    session = WorkoutSession(
        user_id=user_id,
        source=source,
        started_at=started_at,
        completed_at=started_at + timedelta(minutes=30),
    )
    db.add(session)
    db.flush()
    workout_set = WorkoutSet(
        session_id=session.id,
        movement_id=movement.id,
        analysis_id=analysis_id,
        position=0,
        source=source,
        performer=performer,
        intent=intent,
        reps=reps,
        hold_seconds=hold_seconds,
    )
    db.add(workout_set)
    db.commit()
    return workout_set


def _movement(payload: dict, movement_id: uuid.UUID) -> dict:
    return next(item for item in payload["movements"] if item["id"] == str(movement_id))


def test_empty_data_returns_valid_empty_summary(
    client: TestClient,
    progress_data,
):
    user_a, _, pull_up, _, _ = progress_data
    payload = client.get("/progress/summary", headers=_auth(user_a)).json()
    assert payload["consistency"]["workouts_this_week"] == 0
    assert payload["consistency"]["active_days_this_week"] == 0
    assert payload["consistency"]["sets_this_week"] == 0
    assert _movement(payload, pull_up.id)["metrics"] == []


def test_consistency_is_owner_scoped_and_excludes_non_self_sets(
    client: TestClient,
    db: Session,
    progress_data,
):
    user_a, user_b, pull_up, _, _ = progress_data
    monday = datetime.now(UTC) - timedelta(days=datetime.now(UTC).weekday())
    monday = monday.replace(hour=9, minute=0, second=0, microsecond=0)
    _add_set(db, user_a, pull_up, started_at=monday, reps=6)
    _add_set(db, user_a, pull_up, started_at=monday + timedelta(hours=2), reps=7)
    _add_set(db, user_a, pull_up, started_at=monday + timedelta(days=1), reps=8)
    _add_set(db, user_a, pull_up, started_at=monday, reps=20, performer="other")
    _add_set(db, user_b, pull_up, started_at=monday, reps=30)

    consistency = client.get(
        "/progress/summary", headers=_auth(user_a)
    ).json()["consistency"]
    assert consistency["workouts_this_week"] == 3
    assert consistency["active_days_this_week"] == 2
    assert consistency["sets_this_week"] == 3


def test_rep_and_hold_trends_are_separate_and_descriptive(
    client: TestClient,
    db: Session,
    progress_data,
):
    user_a, _, pull_up, _, _ = progress_data
    recorded = datetime.now(UTC) - timedelta(days=2)
    _add_set(db, user_a, pull_up, started_at=recorded, reps=5)
    _add_set(db, user_a, pull_up, started_at=recorded + timedelta(days=1), reps=8)
    _add_set(
        db,
        user_a,
        pull_up,
        started_at=recorded + timedelta(hours=1),
        hold_seconds=Decimal("11.500"),
    )

    movement = _movement(
        client.get("/progress/summary", headers=_auth(user_a)).json(), pull_up.id
    )
    metrics = {item["measurement"]: item for item in movement["metrics"]}
    assert [point["value"] for point in metrics["reps"]["points"]] == [5.0, 8.0]
    assert [point["value"] for point in metrics["hold_seconds"]["points"]] == [11.5]
    assert metrics["reps"]["label"] == "Reps"
    assert metrics["hold_seconds"]["label"] == "Hold duration"
    assert "max" not in str(movement).lower()


def test_other_and_unknown_performers_do_not_affect_personal_trend(
    client: TestClient,
    db: Session,
    progress_data,
):
    user_a, _, pull_up, _, _ = progress_data
    recorded = datetime.now(UTC)
    _add_set(db, user_a, pull_up, started_at=recorded, reps=6)
    _add_set(db, user_a, pull_up, started_at=recorded, reps=40, performer="other")
    _add_set(db, user_a, pull_up, started_at=recorded, reps=50, performer="unknown")
    movement = _movement(
        client.get("/progress/summary", headers=_auth(user_a)).json(), pull_up.id
    )
    assert [point["value"] for point in movement["metrics"][0]["points"]] == [6.0]


def test_standalone_analysis_is_not_progress_but_linked_self_set_is(
    client: TestClient,
    db: Session,
    progress_data,
):
    user_a, _, pull_up, _, analysis = progress_data
    before = _movement(
        client.get("/progress/summary", headers=_auth(user_a)).json(), pull_up.id
    )
    assert before["metrics"] == []

    linked = _add_set(
        db,
        user_a,
        pull_up,
        started_at=datetime.now(UTC),
        reps=9,
        source="uploaded_analysis",
        analysis_id=analysis.id,
        intent="assessment",
    )
    after = _movement(
        client.get("/progress/summary", headers=_auth(user_a)).json(), pull_up.id
    )
    point = after["metrics"][0]["points"][0]
    assert point["value"] == 9.0
    assert point["source"] == "uploaded_analysis"
    assert point["workout_set_id"] == str(linked.id)
