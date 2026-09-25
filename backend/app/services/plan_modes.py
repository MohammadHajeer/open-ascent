"""Normalized Library plan inputs; SAF-04 remains the prescription authority."""

from __future__ import annotations

import json
import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.movement import Movement
from app.models.profile import Profile
from app.schemas.plan_generation import LibraryPlanRequest
from app.services.coach_context import get_athlete_profile_context
from app.services.movement_documentation import MovementDocumentationService
from app.services.progress import get_progress_summary
from app.services.readiness import ReadinessService
from app.services.readiness_evidence import ReadinessEvidenceBuilder


class ProgressUnavailable(ValueError):
    pass


EQUIPMENT_REQUIREMENTS = {
    "pull-up": "pull_up_bar", "chin-up": "pull_up_bar",
    "close-grip-pull-up": "pull_up_bar", "wide-grip-pull-up": "pull_up_bar",
    "high-pull-up": "pull_up_bar", "muscle-up": "pull_up_bar",
    "front-lever": "pull_up_bar", "back-lever": "pull_up_bar",
    "inverted-deadlift": "pull_up_bar", "dips": "dip_bars",
}


def equipment_available(slug: str, coaching_context: dict) -> bool:
    required = EQUIPMENT_REQUIREMENTS.get(slug)
    available = set(coaching_context.get("equipment") or [])
    return required is None or required in available or "rings" in available


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


def generation_context(db: Session, profile: Profile, metadata: dict) -> str:
    mode = metadata["mode"]
    result: dict = {"mode": mode, "profile": get_athlete_profile_context(db, profile.id)}
    if metadata.get("note"):
        result["athlete_preference"] = metadata["note"]
    if mode == "goal":
        goal = metadata["goal"]
        result["goal"] = goal
        if goal.get("movement_id"):
            movement_id = uuid.UUID(goal["movement_id"])
            decision = ReadinessService.evaluate(ReadinessEvidenceBuilder.build(
                db, user_id=profile.id, movement_id=movement_id
            ))
            result["goal_readiness_for_guidance_only"] = {
                "status": decision.status.value,
                "missing_evidence": decision.missing_evidence[:3],
                "failed_requirements": decision.failed_requirements[:3],
            }
    if mode == "progress":
        result["progress"] = progress_context(db, profile.id)
    return json.dumps(result, separators=(",", ":"))
