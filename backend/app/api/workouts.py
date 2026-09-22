from __future__ import annotations

import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, HTTPException, status

from app.api.dependencies.auth import AthleteProfile
from app.db.database import DbSession
from app.models.movement import Movement
from app.models.training import WorkoutSession, WorkoutSet
from app.schemas.workout import (
    WorkoutSessionCreate,
    WorkoutSessionDetail,
    WorkoutSessionFinish,
    WorkoutSessionRead,
    WorkoutSetCreate,
    WorkoutSetRead,
    WorkoutSetUpdate,
)
from app.services import workout as service

router = APIRouter(prefix="/workout-sessions", tags=["workouts"])


def _session_read(session: WorkoutSession) -> WorkoutSessionRead:
    return WorkoutSessionRead.model_validate(session, from_attributes=True)


def _set_read(workout_set: WorkoutSet, movement_name: str) -> WorkoutSetRead:
    return WorkoutSetRead(
        id=workout_set.id,
        session_id=workout_set.session_id,
        movement_id=workout_set.movement_id,
        movement_name=movement_name,
        position=workout_set.position,
        source=workout_set.source,
        performer=workout_set.performer,
        intent=workout_set.intent,
        reps=workout_set.reps,
        hold_seconds=workout_set.hold_seconds,
        analysis_id=workout_set.analysis_id,
        live_coach_session_ref=workout_set.live_coach_session_ref,
        created_at=workout_set.created_at,
        updated_at=workout_set.updated_at,
    )


def _detail(db: DbSession, session: WorkoutSession) -> WorkoutSessionDetail:
    return WorkoutSessionDetail(
        **_session_read(session).model_dump(),
        sets=[_set_read(item, name) for item, name in service.list_sets(db, session.id)],
    )


def _raise_service_error(exc: Exception) -> None:
    if isinstance(exc, service.WorkoutNotFoundError):
        raise HTTPException(
            status_code=404,
            detail="Workout session or set not found.",
        ) from exc
    if isinstance(exc, service.WorkoutConflictError):
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("", response_model=WorkoutSessionDetail, status_code=status.HTTP_201_CREATED)
def create_workout_session(
    payload: WorkoutSessionCreate,
    profile: AthleteProfile,
    db: DbSession,
) -> WorkoutSessionDetail:
    return _detail(db, service.create_session(db, profile.id, payload))


@router.get("", response_model=list[WorkoutSessionRead])
def list_workout_sessions(
    profile: AthleteProfile,
    db: DbSession,
) -> list[WorkoutSessionRead]:
    return [_session_read(item) for item in service.list_sessions(db, profile.id)]


@router.get("/{session_id}", response_model=WorkoutSessionDetail)
def get_workout_session(
    session_id: uuid.UUID,
    profile: AthleteProfile,
    db: DbSession,
) -> WorkoutSessionDetail:
    try:
        return _detail(db, service.get_owned_session(db, profile.id, session_id))
    except service.WorkoutNotFoundError as exc:
        _raise_service_error(exc)


@router.post(
    "/{session_id}/sets",
    response_model=WorkoutSetRead,
    status_code=status.HTTP_201_CREATED,
)
def add_workout_set(
    session_id: uuid.UUID,
    payload: WorkoutSetCreate,
    profile: AthleteProfile,
    db: DbSession,
) -> WorkoutSetRead:
    try:
        workout_set = service.add_set(db, profile.id, session_id, payload)
        movement = db.get(Movement, workout_set.movement_id)
        if movement is None:  # Protected by the foreign key and service validation.
            raise service.WorkoutValidationError("Movement does not exist.")
        return _set_read(workout_set, movement.name)
    except (
        service.WorkoutNotFoundError,
        service.WorkoutValidationError,
        service.WorkoutConflictError,
    ) as exc:
        _raise_service_error(exc)


@router.patch("/{session_id}/sets/{set_id}", response_model=WorkoutSetRead)
def update_workout_set(
    session_id: uuid.UUID,
    set_id: uuid.UUID,
    payload: WorkoutSetUpdate,
    profile: AthleteProfile,
    db: DbSession,
) -> WorkoutSetRead:
    try:
        workout_set = service.update_set(db, profile.id, session_id, set_id, payload)
        movement = db.get(Movement, workout_set.movement_id)
        if movement is None:
            raise service.WorkoutValidationError("Movement does not exist.")
        return _set_read(workout_set, movement.name)
    except (
        service.WorkoutNotFoundError,
        service.WorkoutValidationError,
        service.WorkoutConflictError,
    ) as exc:
        _raise_service_error(exc)


@router.post("/{session_id}/finish", response_model=WorkoutSessionDetail)
def finish_workout_session(
    session_id: uuid.UUID,
    payload: WorkoutSessionFinish,
    profile: AthleteProfile,
    db: DbSession,
) -> WorkoutSessionDetail:
    try:
        session = service.get_owned_session(db, profile.id, session_id)
        completed_at = payload.completed_at or datetime.now(UTC)
        if completed_at < session.started_at:
            raise service.WorkoutValidationError(
                "Completion cannot precede start time."
            )
        session.completed_at = completed_at
        if payload.notes is not None:
            session.notes = payload.notes
        db.commit()
        db.refresh(session)
        return _detail(db, session)
    except (service.WorkoutNotFoundError, service.WorkoutValidationError) as exc:
        _raise_service_error(exc)
