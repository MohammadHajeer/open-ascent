from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.analysis import Analysis
from app.models.movement import Movement
from app.models.profile import Profile
from app.models.training import WorkoutSession, WorkoutSet
from app.schemas.workout import WorkoutSessionCreate, WorkoutSetCreate, WorkoutSetUpdate


class WorkoutNotFoundError(Exception):
    pass


class WorkoutValidationError(Exception):
    pass


class WorkoutConflictError(Exception):
    pass


def get_owned_session(
    db: Session, user_id: uuid.UUID, session_id: uuid.UUID
) -> WorkoutSession:
    session = db.scalar(
        select(WorkoutSession).where(
            WorkoutSession.id == session_id,
            WorkoutSession.user_id == user_id,
        )
    )
    if session is None:
        raise WorkoutNotFoundError
    return session


def create_session(
    db: Session, user_id: uuid.UUID, payload: WorkoutSessionCreate
) -> tuple[WorkoutSession, bool]:
    existing = db.scalar(
        select(WorkoutSession).where(
            WorkoutSession.user_id == user_id,
            WorkoutSession.completed_at.is_(None),
        )
    )
    if existing is not None:
        return existing, False
    session = WorkoutSession(
        user_id=user_id,
        source=payload.source,
        started_at=payload.started_at or datetime.now(UTC),
        notes=payload.notes,
    )
    try:
        with db.begin_nested():
            db.add(session)
            db.flush()
    except IntegrityError as exc:
        if getattr(getattr(exc.orig, "diag", None), "constraint_name", None) != (
            "uq_workout_sessions_one_active_per_user"
        ):
            raise
        # A competing request may have committed the active session first.
        existing = db.scalar(
            select(WorkoutSession).where(
                WorkoutSession.user_id == user_id,
                WorkoutSession.completed_at.is_(None),
            )
        )
        if existing is not None:
            return existing, False
        raise WorkoutConflictError("An active workout already exists.") from exc
    db.commit()
    db.refresh(session)
    return session, True


def list_sessions(db: Session, user_id: uuid.UUID) -> list[tuple[WorkoutSession, int]]:
    return list(
        db.execute(
            select(WorkoutSession, func.count(WorkoutSet.id))
            .outerjoin(WorkoutSet, WorkoutSet.session_id == WorkoutSession.id)
            .where(WorkoutSession.user_id == user_id)
            .group_by(WorkoutSession.id)
            .order_by(WorkoutSession.started_at.desc(), WorkoutSession.id.desc())
        ).tuples()
    )


def list_recent_coach_sessions(
    db: Session, user_id: uuid.UUID, movement_id: uuid.UUID | None, limit: int
) -> list[tuple[WorkoutSession, list[tuple[WorkoutSet, str]]]]:
    """Owner-scoped personal sets, retaining source, performer and intent labels."""
    statement = (
        select(WorkoutSession)
        .join(WorkoutSet, WorkoutSet.session_id == WorkoutSession.id)
        .where(WorkoutSession.user_id == user_id, WorkoutSet.performer == "self")
    )
    if movement_id is not None:
        statement = statement.where(WorkoutSet.movement_id == movement_id)
    sessions = db.scalars(
        statement.distinct()
        .order_by(WorkoutSession.started_at.desc(), WorkoutSession.id.desc())
        .limit(limit)
    ).all()
    result = []
    for session in sessions:
        sets_statement = (
            select(WorkoutSet, Movement.name)
            .join(Movement, Movement.id == WorkoutSet.movement_id)
            .where(WorkoutSet.session_id == session.id, WorkoutSet.performer == "self")
            .order_by(WorkoutSet.position, WorkoutSet.id)
            .limit(10)
        )
        if movement_id is not None:
            sets_statement = sets_statement.where(WorkoutSet.movement_id == movement_id)
        result.append((session, list(db.execute(sets_statement).tuples())))
    return result


def get_active_session(
    db: Session, user_id: uuid.UUID
) -> tuple[WorkoutSession, int] | None:
    return db.execute(
        select(WorkoutSession, func.count(WorkoutSet.id))
        .outerjoin(WorkoutSet, WorkoutSet.session_id == WorkoutSession.id)
        .where(
            WorkoutSession.user_id == user_id,
            WorkoutSession.completed_at.is_(None),
        )
        .group_by(WorkoutSession.id)
    ).one_or_none()


def list_sets(db: Session, session_id: uuid.UUID) -> list[tuple[WorkoutSet, str]]:
    return list(
        db.execute(
            select(WorkoutSet, Movement.name)
            .join(Movement, Movement.id == WorkoutSet.movement_id)
            .where(WorkoutSet.session_id == session_id)
            .order_by(WorkoutSet.position, WorkoutSet.created_at)
        ).tuples()
    )


def discard_empty_session(
    db: Session, user_id: uuid.UUID, session_id: uuid.UUID
) -> None:
    session = db.scalar(
        select(WorkoutSession)
        .where(WorkoutSession.id == session_id, WorkoutSession.user_id == user_id)
        .with_for_update()
    )
    if session is None:
        raise WorkoutNotFoundError
    if session.completed_at is not None:
        raise WorkoutConflictError("Only an unfinished workout can be discarded.")
    if db.scalar(
        select(WorkoutSet.id).where(WorkoutSet.session_id == session_id).limit(1)
    ):
        raise WorkoutConflictError("A workout with sets cannot be discarded.")
    db.delete(session)
    db.commit()


def _validate_links(
    db: Session,
    user_id: uuid.UUID,
    movement_id: uuid.UUID,
    source: str,
    analysis_id: uuid.UUID | None,
    live_coach_session_ref: str | None,
) -> None:
    if db.get(Movement, movement_id) is None:
        raise WorkoutValidationError("Movement does not exist.")
    if source == "uploaded_analysis":
        analysis = db.scalar(
            select(Analysis).where(
                Analysis.id == analysis_id,
                Analysis.user_id == user_id,
                Analysis.owner_kind == "authenticated",
            )
        )
        if analysis is None:
            raise WorkoutValidationError("Analysis is not eligible for linking.")
        if analysis.status != "completed":
            raise WorkoutValidationError("Only completed analyses can be linked.")
        if analysis.movement_id != movement_id:
            raise WorkoutValidationError("Analysis movement does not match the set.")
    elif analysis_id is not None:
        raise WorkoutValidationError("analysis_id requires uploaded_analysis source.")
    if source != "live_coach" and live_coach_session_ref is not None:
        raise WorkoutValidationError(
            "live_coach_session_ref requires live_coach source."
        )


def add_set(
    db: Session,
    user_id: uuid.UUID,
    session_id: uuid.UUID,
    payload: WorkoutSetCreate,
) -> WorkoutSet:
    get_owned_session(db, user_id, session_id)
    _validate_links(
        db,
        user_id,
        payload.movement_id,
        payload.source,
        payload.analysis_id,
        payload.live_coach_session_ref,
    )
    workout_set = WorkoutSet(session_id=session_id, **payload.model_dump())
    db.add(workout_set)
    try:
        db.flush()
        if workout_set.analysis_id is not None:
            from app.services.athlete_state import recalibrate_from_analysis

            recalibrate_from_analysis(
                db, user_id=user_id, analysis_id=workout_set.analysis_id
            )
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise WorkoutConflictError(
            "Set position is already used in this session."
        ) from exc
    db.refresh(workout_set)
    return workout_set


def update_set(
    db: Session,
    user_id: uuid.UUID,
    session_id: uuid.UUID,
    set_id: uuid.UUID,
    payload: WorkoutSetUpdate,
) -> WorkoutSet:
    get_owned_session(db, user_id, session_id)
    workout_set = db.scalar(
        select(WorkoutSet).where(
            WorkoutSet.id == set_id,
            WorkoutSet.session_id == session_id,
        )
    )
    if workout_set is None:
        raise WorkoutNotFoundError
    changes = payload.model_dump(exclude_unset=True)
    if workout_set.analysis_id is not None and any(
        field in changes and changes[field] != getattr(workout_set, field)
        for field in ("source", "performer", "intent", "analysis_id")
    ):
        profile = db.scalar(
            select(Profile).where(Profile.id == user_id).with_for_update()
        )
        evidence_ref = f"analysis:{workout_set.analysis_id}"
        capabilities = (
            (profile.athlete_state or {}).get("capabilities", {}) if profile else {}
        )
        for capability in capabilities.values():
            if not isinstance(capability, dict):
                continue
            versions = [capability, *(capability.get("history") or [])]
            if any(
                evidence_ref in version.get("evidence_refs", []) for version in versions
            ):
                raise WorkoutValidationError(
                    "An analysis used as measured profile evidence must retain its attribution."
                )
    values = {
        "source": workout_set.source,
        "analysis_id": workout_set.analysis_id,
        "live_coach_session_ref": workout_set.live_coach_session_ref,
        "reps": workout_set.reps,
        "hold_seconds": workout_set.hold_seconds,
    } | changes
    if (values["reps"] is None) == (values["hold_seconds"] is None):
        raise WorkoutValidationError("Provide exactly one of reps or hold_seconds.")
    _validate_links(
        db,
        user_id,
        workout_set.movement_id,
        values["source"],
        values["analysis_id"],
        values["live_coach_session_ref"],
    )
    for field, value in changes.items():
        setattr(workout_set, field, value)
    try:
        db.flush()
        if workout_set.analysis_id is not None:
            from app.services.athlete_state import recalibrate_from_analysis

            recalibrate_from_analysis(
                db, user_id=user_id, analysis_id=workout_set.analysis_id
            )
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise WorkoutConflictError(
            "Set position is already used in this session."
        ) from exc
    db.refresh(workout_set)
    return workout_set
