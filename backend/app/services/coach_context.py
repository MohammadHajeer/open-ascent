"""Small, evidence-labelled athlete context for a single coach turn."""

from __future__ import annotations

import json
import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.analysis import Analysis
from app.models.movement import Movement
from app.models.profile import Profile
from app.models.training import WorkoutSession, WorkoutSet


def get_athlete_profile_context(db: Session, user_id: uuid.UUID) -> dict | None:
    """Whitelisted onboarding evidence; never promote self reports to measurements."""
    profile = db.scalar(select(Profile).where(Profile.id == user_id, Profile.app_role == "athlete"))
    if profile is None:
        return None
    context = profile.coaching_context or {}
    assessment = profile.initial_assessment or {}
    answers = assessment.get("answers") or {}
    state = profile.athlete_state or {}
    reported = {
        key: context[key]
        for key in ("primary_goal", "equipment", "availability")
        if key in context
    }
    reported["starting_training_experience"] = answers.get("training_experience")
    reported["starting_self_reported_clean_rep_max"] = {
        key: value for key, value in (answers.get("max_clean_reps") or {}).items()
        if key in ("pull_up", "push_up", "dips") and isinstance(value, int)
    }
    avoided = {str(item) for item in context.get("avoid_movement_ids", [])[:12]}
    if avoided:
        reported["movements_to_avoid"] = [
            movement.name[:80] for movement in db.scalars(select(Movement).order_by(Movement.name))
            if str(movement.id) in avoided
        ][:12]
    dimensions = state.get("dimensions") or {}
    return {
        "athlete_reported_profile": reported,
        "initial_assessment": {
            "source": "self_reported",
            "submitted_at": assessment.get("submitted_at"),
            "dimension_stages": {
                key: value for key, value in (answers.get("dimension_stage") or {}).items()
                if key in ("pulling", "pushing", "core", "balance", "statics")
            },
        },
        "athlete_state": {
            "overall_level": state.get("overall_level"),
            "overall_source": state.get("overall_source"),
            "dimensions": {
                key: {
                    field: value[field] for field in ("level", "source", "confidence", "observed_at")
                    if field in value
                }
                for key, value in dimensions.items()
                if key in ("pulling", "pushing", "core", "balance", "statics")
                and isinstance(value, dict)
            },
        },
    }


def build_coach_context(db: Session, profile: Profile, question: str) -> str:
    context = profile.coaching_context or {}
    assessment = (profile.initial_assessment or {}).get("answers", {})
    result: dict = {"athlete_reported_profile": {}}
    for key in ("primary_goal", "equipment", "availability"):
        if context.get(key) is not None:
            result["athlete_reported_profile"][key] = context[key]
    if assessment.get("training_experience"):
        result["athlete_reported_profile"]["starting_training_experience"] = assessment[
            "training_experience"
        ]

    # Exact movement name matching keeps unrelated evidence out of model input.
    movements = list(db.scalars(select(Movement).order_by(Movement.name)))
    avoided = {str(value) for value in context.get("avoid_movement_ids", [])}
    avoided_names = [m.name for m in movements if str(m.id) in avoided][:12]
    if avoided_names:
        result["athlete_reported_profile"]["movements_to_avoid"] = avoided_names
    normalized_question = question.lower().replace("-", " ")
    mentioned = [
        m for m in movements if m.name.lower().replace("-", " ") in normalized_question
    ]
    if not mentioned and any(
        term in normalized_question
        for term in ("progress", "training week", "recent workout", "my training")
    ):
        recent_movement_ids = db.scalars(
            select(WorkoutSet.movement_id)
            .join(WorkoutSession, WorkoutSession.id == WorkoutSet.session_id)
            .where(WorkoutSession.user_id == profile.id, WorkoutSet.performer == "self")
            .order_by(WorkoutSession.started_at.desc())
            .limit(4)
        ).all()
        mentioned = [m for m in movements if m.id in recent_movement_ids][:2]
    if not mentioned:
        return json.dumps(result, separators=(",", ":"))
    movement_ids = [m.id for m in mentioned[:2]]
    names = {m.id: m.name for m in mentioned[:2]}
    dimension = None
    movement_text = " ".join(m.name.lower() for m in mentioned[:2])
    if "pull" in movement_text or "chin" in movement_text:
        dimension = "pulling"
    elif "push" in movement_text or "dip" in movement_text:
        dimension = "pushing"
    elif "lever" in movement_text:
        dimension = "statics"
    elif "handstand" in movement_text:
        dimension = "balance"
    state = (
        (profile.athlete_state or {}).get("dimensions", {}).get(dimension)
        if dimension
        else None
    )
    if isinstance(state, dict) and state.get("source") == "self_reported":
        result["provisional_self_reported_state"] = {
            "dimension": dimension,
            "level": state.get("level"),
            "observed_at": state.get("observed_at"),
        }
    reported_max = assessment.get("max_clean_reps", {})
    reported_key = {"pulling": "pull_up", "pushing": "push_up"}.get(dimension)
    if reported_key and isinstance(reported_max.get(reported_key), int):
        result["starting_self_reported_clean_rep_max"] = {
            "movement": reported_key,
            "reps": reported_max[reported_key],
        }
    rows = db.execute(
        select(WorkoutSet, WorkoutSession.started_at)
        .join(WorkoutSession, WorkoutSession.id == WorkoutSet.session_id)
        .where(
            WorkoutSession.user_id == profile.id,
            WorkoutSet.performer == "self",
            WorkoutSet.movement_id.in_(movement_ids),
        )
        .order_by(WorkoutSession.started_at.desc(), WorkoutSet.position.desc())
        .limit(4)
    ).all()
    result["recent_self_logged_sets"] = [
        {
            "movement": names[item.movement_id],
            "date": started.date().isoformat(),
            "reps": item.reps,
            "hold_seconds": float(item.hold_seconds)
            if item.hold_seconds is not None
            else None,
            "intent": item.intent,
        }
        for item, started in rows
    ]
    # Standalone uploads are not automatically personal evidence. Only a
    # linked self-attributed set can ground a personal analysis statement.
    linked_ids = {item.analysis_id for item, _ in rows if item.analysis_id}
    if linked_ids:
        analyses = db.scalars(
            select(Analysis)
            .where(
                Analysis.id.in_(linked_ids),
                Analysis.user_id == profile.id,
                Analysis.status == "completed",
            )
            .order_by(Analysis.created_at.desc())
            .limit(2)
        ).all()
        result["linked_analysis_findings"] = []
        for analysis in analyses:
            reps = (analysis.result or {}).get("reps", [])
            findings = [
                {
                    "rep": rep.get("rep_index"),
                    "findings": rep.get("technique_findings", [])[:4],
                }
                for rep in reps[:6]
                if rep.get("technique_findings")
            ]
            if findings:
                result["linked_analysis_findings"].append(
                    {"date": analysis.created_at.date().isoformat(), "reps": findings}
                )
    return json.dumps(result, separators=(",", ":"))
