"""Authoritative validation and explicit persistence for weekly plans."""

from __future__ import annotations

import uuid

from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.coach import CoachGeneration, Conversation, Message
from app.models.movement import Movement
from app.models.training import TrainingPlan, TrainingPlanPreview
from app.schemas.readiness import ReadinessStatus
from app.schemas.training_plan import WeeklyPlanCandidate
from app.services.feature_usage import consume_usage
from app.services.movement import MovementService
from app.services.movement_documentation import MovementDocumentationService
from app.services.readiness import ReadinessService
from app.services.readiness_evidence import ReadinessEvidenceBuilder

PLAN_READY_MESSAGE = (
    "Your weekly plan preview is ready. Review it below and choose Save Plan "
    "only if you want to keep it."
)


class PlanValidationError(ValueError):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


class PlanNotFoundError(LookupError):
    pass


def validate_candidate(
    db: Session, user_id: uuid.UUID, candidate: WeeklyPlanCandidate
) -> None:
    """Run canonical, prescription, and SAF-04 gates before preview and Save."""
    checked: set[uuid.UUID] = set()
    for day in candidate.days:
        for exercise in day.exercises:
            movement = db.get(Movement, exercise.movement_id)
            if movement is None:
                raise PlanValidationError(
                    "movement_not_found", "A proposed movement is not in the catalog."
                )
            if MovementDocumentationService.get_published(db, movement.id) is None:
                raise PlanValidationError(
                    "movement_unpublished",
                    f"{movement.name[:80]} has no published movement guide.",
                )
            if not MovementService.is_plan_prescription_compatible(
                movement, reps=exercise.reps, hold_seconds=exercise.hold_seconds
            ):
                raise PlanValidationError(
                    "prescription_mismatch",
                    f"{movement.name[:80]} has an incompatible repetition or hold target.",
                )
            if movement.id in checked:
                continue
            checked.add(movement.id)
            evidence = ReadinessEvidenceBuilder.build(
                db, user_id=user_id, movement_id=movement.id
            )
            decision = ReadinessService.evaluate(evidence)
            if decision.status is not ReadinessStatus.PASS:
                detail = (
                    decision.failed_requirements or decision.missing_evidence
                )[:2]
                raise PlanValidationError(
                    "readiness_failed"
                    if decision.status is ReadinessStatus.FAIL
                    else "readiness_unknown",
                    f"{movement.name[:80]} cannot be prescribed yet: "
                    + "; ".join(item[:180] for item in detail),
                )


def complete_preview(
    db: Session,
    *,
    generation_id: uuid.UUID,
    user_id: uuid.UUID,
    candidate: WeeklyPlanCandidate,
    provider_response_id: str,
) -> TrainingPlanPreview:
    """Commit a validated preview and Coach completion in one transaction."""
    generation = db.scalar(
        select(CoachGeneration)
        .where(CoachGeneration.id == generation_id, CoachGeneration.kind == "plan")
        .with_for_update()
    )
    if generation is None:
        raise PlanNotFoundError
    conversation = db.get(Conversation, generation.conversation_id)
    if conversation is None or conversation.user_id != user_id:
        raise PlanNotFoundError
    existing = db.scalar(
        select(TrainingPlanPreview).where(
            TrainingPlanPreview.coach_generation_id == generation_id,
            TrainingPlanPreview.user_id == user_id,
        )
    )
    if existing is not None and generation.status == "completed":
        return existing
    if generation.status not in {"requesting", "streaming"}:
        raise PlanValidationError("stale_generation", "Plan generation is no longer active.")
    validate_candidate(db, user_id, candidate)
    preview = TrainingPlanPreview(
        user_id=user_id,
        coach_generation_id=generation_id,
        plan_document=candidate.model_dump(mode="json"),
    )
    db.add(preview)
    generation.status = "completed"
    generation.provider_response_id = provider_response_id
    generation.error_code = None
    message = db.get(Message, generation.assistant_message_id)
    message.content = PLAN_READY_MESSAGE
    message.status = "completed"
    if generation.feature_usage_id:
        consume_usage(db, generation.feature_usage_id, user_id=user_id)
    db.commit()
    db.refresh(preview)
    return preview


def get_owned_preview(
    db: Session, user_id: uuid.UUID, preview_id: uuid.UUID
) -> TrainingPlanPreview:
    preview = db.scalar(
        select(TrainingPlanPreview).where(
            TrainingPlanPreview.id == preview_id,
            TrainingPlanPreview.user_id == user_id,
        )
    )
    if preview is None:
        raise PlanNotFoundError
    return preview


def preview_read(db: Session, preview: TrainingPlanPreview) -> dict:
    try:
        candidate = WeeklyPlanCandidate.model_validate(preview.plan_document)
    except ValidationError as exc:
        raise PlanValidationError("invalid_preview", "Plan preview is invalid.") from exc
    movements = {
        movement.id: movement
        for movement in db.scalars(
            select(Movement).where(
                Movement.id.in_(
                    {exercise.movement_id for day in candidate.days for exercise in day.exercises}
                )
            )
        )
    }
    return {
        "id": str(preview.id),
        "saved_plan_id": str(preview.saved_plan_id) if preview.saved_plan_id else None,
        "title": candidate.title,
        "summary": candidate.summary,
        "days": [
            {
                "day_index": day.day_index,
                "label": day.label,
                "exercises": [
                    {
                        **exercise.model_dump(mode="json"),
                        "movement_name": movements[exercise.movement_id].name[:80]
                        if exercise.movement_id in movements else "Unavailable movement",
                        "movement_slug": movements[exercise.movement_id].slug
                        if exercise.movement_id in movements else None,
                    }
                    for exercise in day.exercises
                ],
            }
            for day in candidate.days
        ],
    }


def save_preview(
    db: Session, user_id: uuid.UUID, preview_id: uuid.UUID
) -> TrainingPlan:
    preview = db.scalar(
        select(TrainingPlanPreview)
        .where(
            TrainingPlanPreview.id == preview_id,
            TrainingPlanPreview.user_id == user_id,
        )
        .with_for_update()
    )
    if preview is None:
        raise PlanNotFoundError
    if preview.saved_plan_id:
        saved = db.scalar(
            select(TrainingPlan).where(
                TrainingPlan.id == preview.saved_plan_id,
                TrainingPlan.user_id == user_id,
            )
        )
        if saved is None:
            raise PlanNotFoundError
        return saved
    generation = db.get(CoachGeneration, preview.coach_generation_id)
    conversation = db.get(Conversation, generation.conversation_id) if generation else None
    if (
        generation is None or generation.kind != "plan"
        or generation.status != "completed"
        or conversation is None or conversation.user_id != user_id
    ):
        raise PlanValidationError("stale_preview", "Plan preview is not complete.")
    try:
        candidate = WeeklyPlanCandidate.model_validate(preview.plan_document)
    except ValidationError as exc:
        raise PlanValidationError("invalid_preview", "Plan preview is invalid.") from exc
    validate_candidate(db, user_id, candidate)
    saved = TrainingPlan(
        user_id=user_id,
        title=candidate.title,
        plan_document=candidate.model_dump(mode="json"),
    )
    db.add(saved)
    db.flush()
    preview.saved_plan_id = saved.id
    db.commit()
    db.refresh(saved)
    return saved


def get_owned_plan(
    db: Session, user_id: uuid.UUID, plan_id: uuid.UUID
) -> TrainingPlan:
    plan = db.scalar(
        select(TrainingPlan).where(
            TrainingPlan.id == plan_id,
            TrainingPlan.user_id == user_id,
        )
    )
    if plan is None:
        raise PlanNotFoundError
    return plan
