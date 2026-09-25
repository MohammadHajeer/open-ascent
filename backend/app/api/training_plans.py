"""Authenticated plan preview and explicit Save endpoints."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict
from sqlalchemy import func, select

from app.api.dependencies.auth import AthleteProfile
from app.db.database import DbSession
from app.models.enums import FeatureKey, FeatureUsageStatus
from app.models.subscription import FeatureUsage
from app.schemas.plan_generation import LibraryPlanRequest
from app.services import coach as coach_service
from app.services import training_plan as plans
from app.services.entitlements import UnconfiguredAllowanceError, get_user_entitlement
from app.services.feature_usage import (
    FeatureAccessDeniedError,
    QuotaExceededError,
    calendar_month_window,
)
from app.services.plan_modes import (
    ProgressUnavailable,
    available_goals,
    normalize_request,
    progress_context,
)

router = APIRouter(prefix="/coach/plans", tags=["coach-plans"])


class SavePlanInput(BaseModel):
    model_config = ConfigDict(extra="forbid")


@router.get("/generation-options")
def generation_options(profile: AthleteProfile, db: DbSession) -> dict:
    try:
        progress_context(db, profile.id)
        progress_available = True
    except ProgressUnavailable:
        progress_available = False
    entitlement = get_user_entitlement(db, profile.id, FeatureKey.TRAINING_PLAN_GENERATION)
    allowance = entitlement.allowance_units if entitlement and entitlement.enabled else 0
    start, end = calendar_month_window(datetime.now(UTC))
    used = db.scalar(select(func.coalesce(func.sum(FeatureUsage.units), 0)).where(
        FeatureUsage.user_id == profile.id,
        FeatureUsage.feature_key == FeatureKey.TRAINING_PLAN_GENERATION.value,
        FeatureUsage.window_start == start,
        FeatureUsage.window_end == end,
        FeatureUsage.status.in_((FeatureUsageStatus.RESERVED.value, FeatureUsageStatus.CONSUMED.value)),
    )) or 0
    return {"goals": available_goals(db), "progress_available": progress_available,
            "plan_allowance": allowance, "plan_remaining": max(0, allowance - int(used)) if allowance is not None else None}


@router.post("/generations", status_code=202)
def start_library_generation(payload: LibraryPlanRequest, profile: AthleteProfile, db: DbSession) -> dict:
    try:
        content, metadata = normalize_request(db, profile.id, payload)
        conversation, generation, created = coach_service.create_and_reserve_generation(
            db, profile, payload.client_request_id, content, kind="plan", plan_context=metadata
        )
    except ProgressUnavailable as exc:
        raise HTTPException(409, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    except (FeatureAccessDeniedError, QuotaExceededError, UnconfiguredAllowanceError) as exc:
        raise HTTPException(403, "Training plan generation is unavailable or its monthly allowance is exhausted.") from exc
    except RuntimeError as exc:
        raise HTTPException(409, str(exc)) from exc
    if created and generation.status == "reserved":
        coach_service.start_generation(generation.id, profile.id)
    return {"conversation_id": str(conversation.id), "generation_id": str(generation.id), "created": created}


@router.get("/previews/{preview_id}")
def get_preview(preview_id: uuid.UUID, profile: AthleteProfile, db: DbSession) -> dict:
    try:
        preview = plans.get_owned_preview(db, profile.id, preview_id)
        return plans.preview_read(db, preview)
    except plans.PlanNotFoundError as exc:
        raise HTTPException(404, "Plan preview not found.") from exc
    except plans.PlanValidationError as exc:
        raise HTTPException(409, str(exc)) from exc


@router.post("/previews/{preview_id}/save")
def save_preview(
    preview_id: uuid.UUID,
    _payload: SavePlanInput,
    profile: AthleteProfile,
    db: DbSession,
) -> dict:
    try:
        plan = plans.save_preview(db, profile.id, preview_id)
    except plans.PlanNotFoundError as exc:
        raise HTTPException(404, "Plan preview not found.") from exc
    except plans.PlanValidationError as exc:
        raise HTTPException(409, str(exc)) from exc
    return {"id": str(plan.id), "title": plan.title, "saved_at": plan.saved_at.isoformat()}


@router.get("")
def list_saved_plans(profile: AthleteProfile, db: DbSession) -> list[dict]:
    try:
        return [plans.saved_plan_summary(plan) for plan in plans.list_owned_plans(db, profile.id)]
    except plans.PlanValidationError as exc:
        raise HTTPException(409, str(exc)) from exc


@router.get("/{plan_id}")
def get_saved_plan(plan_id: uuid.UUID, profile: AthleteProfile, db: DbSession) -> dict:
    try:
        plan = plans.get_owned_plan(db, profile.id, plan_id)
        return plans.saved_plan_read(db, plan)
    except plans.PlanNotFoundError as exc:
        raise HTTPException(404, "Training plan not found.") from exc
    except plans.PlanValidationError as exc:
        raise HTTPException(409, str(exc)) from exc
