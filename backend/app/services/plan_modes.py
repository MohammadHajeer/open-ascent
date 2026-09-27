"""Normalized plan inputs for Library and Coach; SAF-04 remains the prescription authority."""

from __future__ import annotations

import json
import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.movement import Movement
from app.models.profile import Profile
from app.schemas.plan_generation import LibraryPlanRequest
from app.services.goal_paths import goal_slug_from_text
from app.services.movement_documentation import MovementDocumentationService
from app.services.plan_engine import (  # noqa: F401
    EQUIPMENT_REQUIREMENTS,
    PlanningContext,
    build_planning_context,
    equipment_available,
    prompt_payload,
)
from app.services.progress import get_progress_summary


class ProgressUnavailable(ValueError):
    pass




def progress_context(db: Session, user_id: uuid.UUID) -> dict:
    summary = get_progress_summary(db, user_id)
    active = [movement for movement in summary.movements if movement.metrics]
    points = [point for movement in active for metric in movement.metrics for point in metric.points]
    # Two distinct self-attributed sessions make a trend meaningful. A single
    # workout can still be discussed in Coach, but cannot anchor adaptation.
    if len({point.workout_session_id for point in points}) < 2:
        raise ProgressUnavailable("Log at least two workouts to adapt a plan. You can start from your profile or build toward a goal now.")
    return {
        "source": "COACH-03 self-attributed workout progress",
        "consistency": summary.consistency.model_dump(mode="json"),
        "movements": [
            {"name": movement.name, "metrics": [
                {"measurement": metric.measurement, "points": [
                    {"date": point.recorded_at.date().isoformat(), "value": point.value,
                     "source": point.source, "intent": point.intent}
                    for point in metric.points[-8:]]}
                for metric in movement.metrics]}
            for movement in active[:5]
        ],
    }


def available_goals(db: Session) -> list[dict]:
    return [
        {"id": str(item.id), "name": item.name[:80]}
        for item in db.scalars(select(Movement).order_by(Movement.name))
        if MovementDocumentationService.get_published(db, item.id) is not None
    ]


def normalize_request(db: Session, user_id: uuid.UUID, request: LibraryPlanRequest) -> tuple[str, dict]:
    metadata: dict = {"mode": request.mode, "note": request.note}
    if request.mode == "profile":
        content = "Build a conservative weekly plan from my profile and onboarding context."
    elif request.mode == "progress":
        progress_context(db, user_id)
        content = "Adapt a weekly plan to my recorded progress and recent workouts."
    else:
        if request.goal_movement_id:
            movement = db.get(Movement, request.goal_movement_id)
            if movement is None or MovementDocumentationService.get_published(db, movement.id) is None:
                raise ValueError("Select a published movement goal.")
            metadata["goal"] = {"movement_id": str(movement.id), "name": movement.name[:80]}
            content = f"Build a weekly plan toward {movement.name[:80]}, starting with safe prerequisites."
        else:
            metadata["goal"] = {"focus": "general_pulling_strength", "name": "General pulling strength"}
            content = "Build a weekly plan toward general pulling strength."
    if request.note:
        content += f" Athlete preference: {request.note}"
    return content, metadata


def planning_context(
    db: Session, user_id: uuid.UUID, metadata: dict | None, request_text: str = ""
) -> PlanningContext:
    """Resolve Library metadata or a Coach request into the one planning context."""
    mode = (metadata or {}).get("mode")
    goal = (metadata or {}).get("goal") or {}
    goal_slug = goal_name = path_key = None
    if metadata is None:
        # Coach requests use the same engine; a named goal selects its path.
        goal_slug = goal_slug_from_text(request_text)
    elif goal.get("movement_id"):
        movement = db.get(Movement, uuid.UUID(goal["movement_id"]))
        goal_slug = movement.slug if movement else None
        goal_name = goal.get("name")
    elif goal.get("focus") == "general_pulling_strength":
        path_key, goal_name = "pull-up", goal.get("name")
    if goal_slug and metadata is None:
        movement = db.scalar(select(Movement).where(Movement.slug == goal_slug))
        goal_name = movement.name[:80] if movement else None
    if mode in {"profile", "progress"}:
        goal_slug = goal_name = None
    return build_planning_context(
        db, user_id, mode=mode, path_key=path_key, goal_slug=goal_slug, goal_name=goal_name,
    )


def generation_context(
    db: Session, profile: Profile, metadata: dict | None, context: PlanningContext | None = None,
) -> str:
    context = context or planning_context(db, profile.id, metadata)
    result = prompt_payload(context)
    if metadata and metadata.get("note"):
        result["athlete_preference"] = metadata["note"]
    if context.mode == "progress":
        result["progress"] = progress_context(db, profile.id)
    return json.dumps(result, separators=(",", ":"))
