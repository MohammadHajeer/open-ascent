from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.analysis import Analysis
from app.models.movement import Movement
from app.models.training import WorkoutSession, WorkoutSet
from app.schemas.workout import WorkoutSessionCreate, WorkoutSetCreate, WorkoutSetUpdate


class WorkoutNotFoundError(Exception):
    pass


class WorkoutValidationError(Exception):
    pass


class WorkoutConflictError(Exception):
    pass


def get_owned_session(db: Session, user_id: uuid.UUID, session_id: uuid.UUID) -> WorkoutSession:
    session = db.scalar(
        select(WorkoutSession).where(
            WorkoutSession.id == session_id,
            WorkoutSession.user_id == user_id,
        )
    )
    if session is None:
        raise WorkoutNotFoundError
    return session


def create_session(db: Session, user_id: uuid.UUID, payload: WorkoutSessionCreate) -> WorkoutSession:
    session = WorkoutSession(
        user_id=user_id,
        source=payload.source,
        started_at=payload.started_at or datetime.now(UTC),
        notes=payload.notes,
    )
    db.add(session)
    db.commit()
    db.refresh(session)
    return session


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


def list_sets(db: Session, session_id: uuid.UUID) -> list[tuple[WorkoutSet, str]]:
    return list(
        db.execute(
            select(WorkoutSet, Movement.name)
            .join(Movement, Movement.id == WorkoutSet.movement_id)
            .where(WorkoutSet.session_id == session_id)
            .order_by(WorkoutSet.position, WorkoutSet.created_at)
        ).tuples()
    )


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
        raise WorkoutValidationError("live_coach_session_ref requires live_coach source.")


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
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise WorkoutConflictError("Set position is already used in this session.") from exc
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
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise WorkoutConflictError("Set position is already used in this session.") from exc
    db.refresh(workout_set)
    return workout_set
