"""Deterministic, owner-scoped updates to measured athlete capabilities."""

from __future__ import annotations

import uuid
from copy import deepcopy
from datetime import UTC, datetime
from math import isfinite

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.analysis import Analysis
from app.models.movement import Movement
from app.models.profile import Profile
from app.models.training import WorkoutSession, WorkoutSet
from app.services.onboarding import derive_athlete_state
from app.services.readiness_evidence import _target_matched_rep_count


def _utc(value: datetime) -> datetime:
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)


def apply_measured_capability(
    state: dict,
    *,
    movement_id: uuid.UUID,
    metric: str,
    intent: str,
    value: float,
    observed_at: datetime,
    evidence_ref: str,
    source: str,
) -> dict | None:
    """Return a changed state only for an existing, comparable max capability.

    This internal reducer accepts only evidence classified by a trusted backend
    boundary. It is never called with client-supplied workout values.
    """
    if source != "uploaded_analysis" or metric not in {"reps", "hold_seconds"}:
        return None
    if intent != "max_test" or isinstance(value, bool) or value < 0:
        return None
    if metric == "reps" and (type(value) is not int or value > 500):
        return None
    if metric == "hold_seconds" and (
        type(value) not in (int, float) or not isfinite(value) or value <= 0
    ):
        return None
    current = (state.get("capabilities") or {}).get(str(movement_id))
    if not isinstance(current, dict) or any(
        current.get(field) != expected
        for field, expected in (
            ("movement_id", str(movement_id)),
            ("metric", metric),
            ("intent", intent),
        )
    ):
        return None
    if current.get("source") not in {"self_reported", "uploaded_analysis"}:
        return None
    try:
        previous_at = _utc(datetime.fromisoformat(current["observed_at"]))
    except (KeyError, TypeError, ValueError):
        return None
    if _utc(observed_at) <= previous_at or evidence_ref in current.get(
        "evidence_refs", []
    ):
        return None

    updated = deepcopy(state)
    replacement = updated["capabilities"][str(movement_id)]
    replacement.setdefault("history", []).append(
        {
            key: replacement[key]
            for key in ("value", "source", "confidence", "observed_at", "evidence_refs")
            if key in replacement
        }
    )
    replacement.update(
        value=value,
        source=source,
        confidence="measured",
        observed_at=_utc(observed_at).isoformat(),
        evidence_refs=[evidence_ref],
    )
    try:
        state_updated_at = _utc(datetime.fromisoformat(updated["updated_at"]))
    except (KeyError, TypeError, ValueError):
        state_updated_at = _utc(observed_at)
    updated["updated_at"] = max(state_updated_at, _utc(observed_at)).isoformat()
    return updated


def recalibrate_from_analysis(
    db: Session, *, user_id: uuid.UUID, analysis_id: uuid.UUID
) -> bool:
    """Apply a verified maximum test when an owned self-performed set links it."""
    analysis = db.scalar(
        select(Analysis)
        .where(Analysis.id == analysis_id, Analysis.user_id == user_id)
        .execution_options(populate_existing=True)
    )
    if (
        analysis is None
        or analysis.owner_kind != "authenticated"
        or analysis.status != "completed"
        or analysis.execution_intent != "max_test"
        or analysis.movement_id is None
        or analysis.completed_at is None
    ):
        return False
    movement = db.get(Movement, analysis.movement_id)
    if movement is None or movement.prescription_type != "repetitions":
        return False
    # A standalone upload does not establish that the athlete performed it.
    # The set's editable count is deliberately ignored; only its attribution
    # and intent connect the deterministic analyzer result to this athlete.
    linked_set_id = db.scalar(
        select(WorkoutSet.id)
        .join(WorkoutSession, WorkoutSession.id == WorkoutSet.session_id)
        .where(
            WorkoutSession.user_id == user_id,
            WorkoutSet.analysis_id == analysis.id,
            WorkoutSet.movement_id == movement.id,
            WorkoutSet.source == "uploaded_analysis",
            WorkoutSet.performer == "self",
            WorkoutSet.intent == "max_test",
        )
        .limit(1)
    )
    if linked_set_id is None:
        return False
    matched_count = _target_matched_rep_count(analysis)
    if matched_count is None or (
        matched_count > 0 and matched_count != analysis.valid_rep_count
    ):
        return False
    profile = db.scalar(
        select(Profile)
        .where(Profile.id == user_id, Profile.app_role == "athlete")
        .with_for_update()
    )
    if profile is None or profile.onboarding_completed_at is None:
        return False

    state = deepcopy(profile.athlete_state or {})
    if str(movement.id) not in (state.get("capabilities") or {}):
        # Existing AUTH-04 profiles predate the explicit capability map.
        assessment = profile.initial_assessment or {}
        if assessment.get("baseline") and assessment.get("submitted_at"):
            baseline = (
                derive_athlete_state(assessment, {movement.slug: str(movement.id)})
                .get("capabilities", {})
                .get(str(movement.id))
            )
            if baseline is not None:
                state.setdefault("capabilities", {})[str(movement.id)] = baseline

    updated = apply_measured_capability(
        state,
        movement_id=movement.id,
        metric="reps",
        intent="max_test",
        value=matched_count,
        observed_at=analysis.completed_at,
        evidence_ref=f"analysis:{analysis.id}",
        source="uploaded_analysis",
    )
    if updated is None:
        return False
    updated["capabilities"][str(movement.id)]["evidence_refs"].append(
        f"workout_set:{linked_set_id}"
    )
    profile.athlete_state = updated
    return True
