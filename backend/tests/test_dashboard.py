from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import Mock

from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.api.dashboard import get_dashboard_context
from app.api.dependencies.auth import get_current_user_id
from app.main import app
from app.models.movement import Movement
from app.models.profile import Profile
from app.models.training import TrainingPlan


def test_dashboard_context_formats_saved_plan_without_database() -> None:
    athlete_id, movement_id = uuid.uuid4(), uuid.uuid4()
    profile = SimpleNamespace(
        id=athlete_id, display_name="Alex Athlete",
        coaching_context={"primary_goal": "strength", "availability": {"days_per_week": 3}},
    )
    plan = SimpleNamespace(
        id=uuid.uuid4(), title="Current week", saved_at=datetime.now(UTC),
        plan_document={"title": "Current week", "summary": "Practice pulling", "days": [{
            "day_index": 1, "label": "Pull", "exercises": [{
                "movement_id": str(movement_id), "sets": 3, "reps": 5,
                "hold_seconds": None, "rest_seconds": 90, "notes": None,
            }],
        }]},
    )
    db = Mock()
    db.scalar.return_value = plan
    db.scalars.return_value = [SimpleNamespace(id=movement_id, name="Pull-Up")]

    result = get_dashboard_context(profile, db)

    assert result.display_name == "Alex Athlete"
    assert result.primary_goal == "strength"
    assert result.days_per_week == 3
    assert result.latest_plan is not None
    assert result.latest_plan.days[0].exercises[0].movement_name == "Pull-Up"
    assert result.latest_plan.days[0].exercises[0].reps == 5


def test_dashboard_context_without_saved_plan() -> None:
    profile = SimpleNamespace(id=uuid.uuid4(), display_name="New Athlete", coaching_context={})
    db = Mock()
    db.scalar.return_value = None

    result = get_dashboard_context(profile, db)

    assert result.display_name == "New Athlete"
    assert result.primary_goal is None
    assert result.days_per_week is None
    assert result.latest_plan is None
    db.scalars.assert_not_called()


def test_dashboard_context_is_owned_and_uses_latest_saved_plan(
    client: TestClient, db: Session
) -> None:
    athlete_id, other_id = uuid.uuid4(), uuid.uuid4()
    for user_id, name in ((athlete_id, "Alex Athlete"), (other_id, "Other Athlete")):
        db.execute(text("INSERT INTO auth.users (id) VALUES (:id)"), {"id": user_id})
        db.add(Profile(id=user_id, display_name=name, app_role="athlete",
                       coaching_context={"primary_goal": "strength", "availability": {"days_per_week": 3}}))
    movement = Movement(slug=f"dashboard-pull-up-{uuid.uuid4().hex[:8]}",
                        name="Pull-Up", family_key="vertical_pull",
                        upload_analysis_supported=True, live_coach_supported=True)
    db.add(movement)
    db.flush()
    document = {
        "title": "Current week", "summary": "Practice pulling",
        "days": [{"day_index": 1, "label": "Pull", "exercises": [{
            "movement_id": str(movement.id), "sets": 3, "reps": 5,
            "hold_seconds": None, "rest_seconds": 90, "notes": None,
        }]}],
    }
    now = datetime.now(UTC)
    db.add_all([
        TrainingPlan(user_id=athlete_id, title="Older week", plan_document=document,
                     saved_at=now - timedelta(days=7)),
        TrainingPlan(user_id=athlete_id, title="Current week", plan_document=document,
                     saved_at=now),
        TrainingPlan(user_id=other_id, title="Private plan", plan_document=document,
                     saved_at=now + timedelta(days=1)),
    ])
    db.commit()
    app.dependency_overrides[get_current_user_id] = lambda: athlete_id
    try:
        response = client.get("/dashboard/context", headers={"Authorization": "Bearer test-token"})
    finally:
        app.dependency_overrides.pop(get_current_user_id, None)

    assert response.status_code == 200
    payload = response.json()
    assert payload["display_name"] == "Alex Athlete"
    assert payload["primary_goal"] == "strength"
    assert payload["days_per_week"] == 3
    assert payload["latest_plan"]["title"] == "Current week"
    assert payload["latest_plan"]["days"][0]["exercises"][0] == {
        "movement_name": "Pull-Up", "sets": 3, "reps": 5, "hold_seconds": None,
    }
