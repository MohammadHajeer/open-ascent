"""Authoritative validation and explicit persistence for weekly plans."""

from __future__ import annotations

import uuid
from collections import Counter, defaultdict
from itertools import pairwise

from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.coach import CoachGeneration, Conversation, Message
from app.models.movement import Movement
from app.models.profile import Profile
from app.models.training import TrainingPlan, TrainingPlanPreview
from app.schemas.readiness import ReadinessStatus
from app.schemas.training_plan import (
    CURRENT_SCHEMA_VERSION,
    PlanExercise,
    PlanOrigin,
    WeeklyPlanCandidate,
    WeeklyPlanProposal,
)
from app.services.feature_usage import consume_usage
from app.services.foundation_readiness import (
    PROVISIONAL_MAX_TRAINING_DAYS,
    is_provisional_pass,
)
from app.services.movement import MovementService
from app.services.movement_documentation import MovementDocumentationService
from app.services.plan_engine import (
    BALANCE_SHARE_LIMIT,
    PATTERN_GROUPS,
    SECONDS_PER_REP,
    PlanningContext,
    PoolEntry,
    build_planning_context,
    equipment_available,
)
from app.services.readiness import ReadinessService
from app.services.readiness_evidence import ReadinessEvidenceBuilder
from app.services.supporting_exercises import (
    CATALOG_VERSION,
    get_supporting_exercise,
    public_details,
)

PLAN_READY_MESSAGE = (
    "Your weekly plan preview is ready. Review it below and choose Save Plan "
    "only if you want to keep it."
)
SESSION_TIME_TOLERANCE = 1.25


class PlanValidationError(ValueError):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


class PlanNotFoundError(LookupError):
    pass


def _clamp(value: int, bounds: tuple[int, int]) -> int:
    return min(max(value, bounds[0]), bounds[1])


def resolve_proposal(
    proposal: WeeklyPlanProposal, context: PlanningContext, *, origin: PlanOrigin | None = None,
) -> WeeklyPlanCandidate:
    """Map pool IDs to typed identities and apply deterministic dosage bounds.

    Plausible numbers outside the athlete's range are moved to the nearest
    bound rather than failing, because a rejected proposal still consumes the
    athlete's generation unit. Impossible values, unknown identities, and wrong
    target types are never repaired.
    """
    days = []
    for day in proposal.days:
        exercises = []
        for item in day.exercises:
            entry = context.pool.get(item.exercise_id.strip())
            if entry is None:
                raise PlanValidationError(
                    "exercise_not_allowed",
                    "The proposal used an exercise outside the allowed exercise pool.",
                )
            amount = item.reps if entry.target == "reps" else item.hold_seconds
            other = item.hold_seconds if entry.target == "reps" else item.reps
            if amount is None or other is not None:
                raise PlanValidationError(
                    "prescription_mismatch",
                    f"{entry.name} needs exactly one {entry.target.replace('_', ' ')} target.",
                )
            amount_limit = 100 if entry.target == "reps" else 600
            if not (1 <= item.sets <= 10 and 1 <= amount <= amount_limit and 0 <= item.rest_seconds <= 600):
                raise ValueError("The proposal contains an impossible prescription value.")
            amount = _clamp(amount, entry.bounds.amount)
            exercises.append({
                "movement_id": str(entry.movement_id) if entry.movement_id else None,
                "supporting_exercise_id": entry.supporting_key,
                "sets": _clamp(item.sets, entry.bounds.sets),
                "reps": amount if entry.target == "reps" else None,
                "hold_seconds": amount if entry.target == "hold_seconds" else None,
                "rest_seconds": _clamp(item.rest_seconds, entry.bounds.rest_seconds),
                "notes": (item.notes or "").strip()[:280] or None,
                "explanation": entry.explanation,
            })
        days.append({"day_index": day.day_index, "label": day.label, "exercises": exercises})
    return WeeklyPlanCandidate.model_validate({
        "schema_version": CURRENT_SCHEMA_VERSION,
        "title": proposal.title, "summary": proposal.summary, "days": days,
        "origin": origin.model_dump(mode="json") if origin else None,
        "path_key": context.path.key, "goal_slug": context.goal_slug,
        "catalog_version": CATALOG_VERSION,
    })


def context_for(db: Session, user_id: uuid.UUID, candidate: WeeklyPlanCandidate, mode: str | None) -> PlanningContext:
    return build_planning_context(
        db, user_id, mode=mode, path_key=candidate.path_key, goal_slug=candidate.goal_slug,
        goal_name=candidate.origin.goal_name if candidate.origin else None,
    )


def _readiness_error(db: Session, user_id: uuid.UUID, movement: Movement) -> PlanValidationError | None:
    decision = ReadinessService.evaluate(
        ReadinessEvidenceBuilder.build(db, user_id=user_id, movement_id=movement.id)
    )
    if decision.status is ReadinessStatus.PASS:
        return None
    detail = (decision.failed_requirements or decision.missing_evidence)[:2]
    return PlanValidationError(
        "readiness_failed" if decision.status is ReadinessStatus.FAIL else "readiness_unknown",
        f"{movement.name[:80]} cannot be prescribed yet: " + "; ".join(item[:180] for item in detail),
    )


def _diagnose(db: Session, user_id: uuid.UUID, context: PlanningContext, exercise: PlanExercise) -> PlanValidationError:
    """Explain why an identity is outside the pool, most fundamental cause first."""
    if exercise.supporting_exercise_id:
        item = get_supporting_exercise(exercise.supporting_exercise_id)
        if item is None:
            return PlanValidationError("exercise_not_found", "A proposed exercise is not in the curated catalog.")
        if item.retired:
            return PlanValidationError("exercise_retired", f"{item.name} is no longer offered.")
        return PlanValidationError(
            "exercise_not_applicable",
            f"{item.name} is not applicable to this plan's training path or your current evidence.",
        )
    movement = db.get(Movement, exercise.movement_id)
    if movement is None:
        return PlanValidationError("movement_not_found", "A proposed movement is not in the catalog.")
    if MovementDocumentationService.get_published(db, movement.id) is None:
        return PlanValidationError("movement_unpublished", f"{movement.name[:80]} has no published movement guide.")
    if movement.prescription_type is None:
        return PlanValidationError("prescription_mismatch", f"{movement.name[:80]} has no reviewed prescription type.")
    readiness = _readiness_error(db, user_id, movement)
    if readiness is not None:
        return readiness
    profile = db.get(Profile, user_id)
    if not equipment_available(movement.slug, (profile.coaching_context or {}) if profile else {}):
        return PlanValidationError("equipment_unavailable", f"{movement.name[:80]} needs equipment outside your profile.")
    return PlanValidationError(
        "exercise_not_allowed", f"{movement.name[:80]} is not part of this plan's training path."
    )


def _validate_items(db: Session, user_id: uuid.UUID, candidate: WeeklyPlanCandidate, context: PlanningContext) -> None:
    for day in candidate.days:
        seen: set[str] = set()
        for exercise in day.exercises:
            if exercise.identity in seen:
                raise PlanValidationError("duplicate_exercise", "An exercise appears twice on the same day.")
            seen.add(exercise.identity)
            entry = context.pool.get(exercise.identity)
            if entry is None:
                raise _diagnose(db, user_id, context, exercise)
            amount = exercise.reps if entry.target == "reps" else exercise.hold_seconds
            if amount is None:
                raise PlanValidationError(
                    "prescription_mismatch", f"{entry.name} has an incompatible repetition or hold target."
                )
            bounds = entry.bounds
            for label, value, (low, high) in (
                ("sets", exercise.sets, bounds.sets),
                ("reps" if entry.target == "reps" else "seconds", amount, bounds.amount),
                ("seconds of rest", exercise.rest_seconds, bounds.rest_seconds),
            ):
                if not low <= value <= high:
                    raise PlanValidationError(
                        "dosage_out_of_range",
                        f"{entry.name}: {value} {label} is outside the {low}-{high} range for your current evidence.",
                    )


def _consecutive(days: list[int]) -> bool:
    ordered = sorted(set(days))
    return any(later - earlier == 1 for earlier, later in pairwise(ordered))


def _validate_week(candidate: WeeklyPlanCandidate, context: PlanningContext) -> None:
    """Plan-level sanity: schema-valid plans can still be nonsensical."""
    limits = context.limits
    if len(candidate.days) > limits.max_training_days:
        raise PlanValidationError(
            "availability_exceeded",
            f"The plan uses {len(candidate.days)} training days; the current limit is {limits.max_training_days}.",
        )
    group_sets: Counter[str] = Counter()
    days_by_entry: dict[str, list[int]] = defaultdict(list)
    total = balance = 0
    for day in candidate.days:
        day_sets = sum(exercise.sets for exercise in day.exercises)
        if day_sets < limits.min_sets_per_day:
            raise PlanValidationError("workload_too_low", f"Day {day.day_index} has too little work to be a training day.")
        if day_sets > limits.max_sets_per_day:
            raise PlanValidationError("workload_too_high", f"Day {day.day_index} has too many working sets.")
        seconds = sum(
            exercise.sets * ((exercise.reps * SECONDS_PER_REP if exercise.reps else exercise.hold_seconds) + exercise.rest_seconds)
            for exercise in day.exercises
        )
        if seconds > limits.session_minutes * 60 * SESSION_TIME_TOLERANCE:
            raise PlanValidationError("session_too_long", f"Day {day.day_index} does not fit your session length.")
        for exercise in day.exercises:
            entry = context.pool[exercise.identity]
            group_sets[PATTERN_GROUPS[entry.pattern]] += exercise.sets
            days_by_entry[entry.exercise_id].append(day.day_index)
            total += exercise.sets
            balance += exercise.sets if entry.role == "balance" else 0
    for group, count in group_sets.items():
        if count > limits.weekly_sets[group]:
            raise PlanValidationError(
                "weekly_volume_exceeded",
                f"The week has {count} {group} sets; the current limit is {limits.weekly_sets[group]}.",
            )
    for exercise_id, day_indices in days_by_entry.items():
        entry = context.pool[exercise_id]
        if entry.intense and _consecutive(day_indices):
            raise PlanValidationError("recovery_spacing", f"{entry.name} needs a rest day between sessions.")
    used: list[PoolEntry] = [context.pool[exercise_id] for exercise_id in days_by_entry]
    pool = list(context.pool.values())
    if context.mode == "progress" and any(entry.recent_history for entry in pool) and not any(
        entry.recent_history for entry in used
    ):
        raise PlanValidationError("progress_ignored", "An adapted plan must build on the movements you have been training.")
    if not any(context.trains_toward_path(entry) for entry in used):
        raise PlanValidationError("goal_irrelevant", f"The plan does not train toward {context.path.name}.")
    if context.goal_directed:
        if any(entry.role == "goal_specific" for entry in pool) and not any(entry.role == "goal_specific" for entry in used):
            raise PlanValidationError("goal_irrelevant", f"The plan leaves out the available {context.path.name} work.")
        if balance > BALANCE_SHARE_LIMIT * total:
            raise PlanValidationError("goal_irrelevant", "Balancing work outweighs the goal path.")
    else:
        available = {PATTERN_GROUPS[entry.pattern] for entry in pool}
        if {"pull", "push"} <= available and not {"pull", "push"} <= set(group_sets):
            raise PlanValidationError("unbalanced_plan", "A general plan should include both pulling and pushing.")


def _validate_legacy(db: Session, user_id: uuid.UUID, candidate: WeeklyPlanCandidate, metadata: dict | None) -> None:
    """Version 1 previews made before supporting exercises stay saveable."""
    checked: set[uuid.UUID] = set()
    provisional: set[uuid.UUID] = set()
    profile = db.get(Profile, user_id)
    context = (profile.coaching_context or {}) if profile else {}
    for day in candidate.days:
        for exercise in day.exercises:
            movement = db.get(Movement, exercise.movement_id)
            if movement is None:
                raise PlanValidationError("movement_not_found", "A proposed movement is not in the catalog.")
            if MovementDocumentationService.get_published(db, movement.id) is None:
                raise PlanValidationError("movement_unpublished", f"{movement.name[:80]} has no published movement guide.")
            if not MovementService.is_plan_prescription_compatible(
                movement, reps=exercise.reps, hold_seconds=exercise.hold_seconds
            ):
                raise PlanValidationError(
                    "prescription_mismatch", f"{movement.name[:80]} has an incompatible repetition or hold target."
                )
            if metadata and not equipment_available(movement.slug, context):
                raise PlanValidationError("equipment_unavailable", f"{movement.name[:80]} needs equipment outside your profile.")
            if movement.id in checked:
                continue
            checked.add(movement.id)
            readiness = _readiness_error(db, user_id, movement)
            if readiness is not None:
                raise readiness
            if any(is_provisional_pass(item) for item in ReadinessEvidenceBuilder.build(
                db, user_id=user_id, movement_id=movement.id
            )):
                provisional.add(movement.id)
    days = (context.get("availability") or {}).get("days_per_week")
    if metadata and isinstance(days, int) and len(candidate.days) > days:
        raise PlanValidationError("availability_exceeded", "The plan exceeds your available training days.")
    if checked and checked == provisional and len(candidate.days) > PROVISIONAL_MAX_TRAINING_DAYS:
        raise PlanValidationError(
            "provisional_volume_exceeded",
            "A starter plan based only on self-reported readiness should use at most three training days.",
        )


def validate_candidate(
    db: Session, user_id: uuid.UUID, candidate: WeeklyPlanCandidate, *,
    mode: str | None = None, metadata: dict | None = None,
) -> PlanningContext | None:
    """Run identity, readiness/applicability, dosage, and week gates before preview and Save."""
    if candidate.schema_version == 1:
        _validate_legacy(db, user_id, candidate, metadata)
        return None
    context = context_for(db, user_id, candidate, mode)
    _validate_items(db, user_id, candidate, context)
    _validate_week(candidate, context)
    return context


def _provisional(db: Session, user_id: uuid.UUID, candidate: WeeklyPlanCandidate, context: PlanningContext | None) -> bool:
    if context is not None:
        return any(context.pool[exercise.identity].provisional for day in candidate.days for exercise in day.exercises)
    return any(
        is_provisional_pass(item)
        for movement_id in {exercise.movement_id for day in candidate.days for exercise in day.exercises}
        for item in ReadinessEvidenceBuilder.build(db, user_id=user_id, movement_id=movement_id)
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
    if candidate.schema_version != CURRENT_SCHEMA_VERSION:
        raise PlanValidationError("legacy_candidate", "New previews must use the current plan format.")
    metadata = generation.plan_context
    context = validate_candidate(db, user_id, candidate, mode=(metadata or {}).get("mode"), metadata=metadata)
    candidate = candidate.model_copy(update={"provisional_readiness": _provisional(db, user_id, candidate, context)})
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


def _movements(db: Session, candidate: WeeklyPlanCandidate) -> dict[uuid.UUID, Movement]:
    ids = {exercise.movement_id for day in candidate.days for exercise in day.exercises if exercise.movement_id}
    return {movement.id: movement for movement in db.scalars(select(Movement).where(Movement.id.in_(ids)))} if ids else {}


def exercise_view(exercise: PlanExercise, movements: dict[uuid.UUID, Movement]) -> dict:
    """Read model for one plan item; supporting exercises carry curated details."""
    view = exercise.model_dump(mode="json")
    if exercise.supporting_exercise_id:
        item = get_supporting_exercise(exercise.supporting_exercise_id)
        return {
            **view, "exercise_kind": "supporting",
            "movement_name": item.name if item else "Unavailable exercise",
            "movement_slug": None,
            "supporting": public_details(item) if item else None,
        }
    movement = movements.get(exercise.movement_id)
    return {
        **view, "exercise_kind": "movement",
        "movement_name": movement.name[:80] if movement else "Unavailable movement",
        "movement_slug": movement.slug if movement else None,
        "supporting": None,
    }


def exercise_display_name(exercise: PlanExercise, movements: dict[uuid.UUID, Movement]) -> str:
    if exercise.supporting_exercise_id:
        item = get_supporting_exercise(exercise.supporting_exercise_id)
        return item.name if item else "Unavailable exercise"
    movement = movements.get(exercise.movement_id)
    return movement.name[:80] if movement else "Unavailable movement"


def _days(db: Session, candidate: WeeklyPlanCandidate) -> list[dict]:
    movements = _movements(db, candidate)
    return [
        {
            "day_index": day.day_index,
            "label": day.label,
            "exercises": [exercise_view(exercise, movements) for exercise in day.exercises],
        }
        for day in candidate.days
    ]


def preview_read(db: Session, preview: TrainingPlanPreview) -> dict:
    try:
        candidate = WeeklyPlanCandidate.model_validate(preview.plan_document)
    except ValidationError as exc:
        raise PlanValidationError("invalid_preview", "Plan preview is invalid.") from exc
    return {
        "id": str(preview.id),
        "saved_plan_id": str(preview.saved_plan_id) if preview.saved_plan_id else None,
        "title": candidate.title,
        "summary": candidate.summary,
        "origin": candidate.origin.model_dump(mode="json") if candidate.origin else None,
        "provisional_readiness": candidate.provisional_readiness,
        "schema_version": candidate.schema_version,
        "days": _days(db, candidate),
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
    metadata = generation.plan_context
    context = validate_candidate(db, user_id, candidate, mode=(metadata or {}).get("mode"), metadata=metadata)
    candidate = candidate.model_copy(update={"provisional_readiness": _provisional(db, user_id, candidate, context)})
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


def list_owned_plans(db: Session, user_id: uuid.UUID) -> list[TrainingPlan]:
    return list(
        db.scalars(
            select(TrainingPlan)
            .where(TrainingPlan.user_id == user_id)
            .order_by(TrainingPlan.saved_at.desc(), TrainingPlan.id.desc())
        )
    )


def saved_plan_summary(plan: TrainingPlan) -> dict:
    try:
        candidate = WeeklyPlanCandidate.model_validate(plan.plan_document)
    except ValidationError as exc:
        raise PlanValidationError("invalid_plan", "Saved plan is invalid.") from exc
    return {
        "id": str(plan.id),
        "title": plan.title,
        "summary": candidate.summary,
        "origin": candidate.origin.model_dump(mode="json") if candidate.origin else None,
        "provisional_readiness": candidate.provisional_readiness,
        "saved_at": plan.saved_at.isoformat(),
        "training_day_count": len(candidate.days),
        "movement_count": len({
            exercise.identity
            for day in candidate.days
            for exercise in day.exercises
        }),
    }


def saved_plan_read(db: Session, plan: TrainingPlan) -> dict:
    try:
        candidate = WeeklyPlanCandidate.model_validate(plan.plan_document)
    except ValidationError as exc:
        raise PlanValidationError("invalid_plan", "Saved plan is invalid.") from exc
    return {
        **saved_plan_summary(plan),
        "plan_document": plan.plan_document,
        "schema_version": candidate.schema_version,
        "days": _days(db, candidate),
    }
