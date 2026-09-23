"""Authenticated plan preview and explicit Save endpoints."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict

from app.api.dependencies.auth import AthleteProfile
from app.db.database import DbSession
from app.services import training_plan as plans

router = APIRouter(prefix="/coach/plans", tags=["coach-plans"])


class SavePlanInput(BaseModel):
    model_config = ConfigDict(extra="forbid")


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


@router.get("/{plan_id}")
def get_saved_plan(plan_id: uuid.UUID, profile: AthleteProfile, db: DbSession) -> dict:
    try:
        plan = plans.get_owned_plan(db, profile.id, plan_id)
    except plans.PlanNotFoundError as exc:
        raise HTTPException(404, "Training plan not found.") from exc
    return {
        "id": str(plan.id),
        "title": plan.title,
        "saved_at": plan.saved_at.isoformat(),
        "plan_document": plan.plan_document,
    }
