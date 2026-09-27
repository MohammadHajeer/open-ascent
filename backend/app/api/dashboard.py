"""Small authenticated context payload for the athlete home."""

from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter
from pydantic import BaseModel
from sqlalchemy import select

from app.api.dependencies.auth import AthleteProfile
from app.db.database import DbSession
from app.models.movement import Movement
from app.models.training import TrainingPlan
from app.schemas.training_plan import WeeklyPlanCandidate
from app.services.training_plan import exercise_display_name

router = APIRouter(prefix="/dashboard", tags=["dashboard"])


class DashboardExercise(BaseModel):
    movement_name: str
    sets: int
    reps: int | None
    hold_seconds: int | None


class DashboardPlanDay(BaseModel):
    day_index: int
    label: str | None
    exercises: list[DashboardExercise]


class DashboardPlan(BaseModel):
    id: str
    title: str
    summary: str | None
    saved_at: datetime
    days: list[DashboardPlanDay]


class DashboardContext(BaseModel):
    display_name: str
    primary_goal: str | None
    days_per_week: int | None
    latest_plan: DashboardPlan | None


@router.get("/context", response_model=DashboardContext)
def get_dashboard_context(profile: AthleteProfile, db: DbSession) -> DashboardContext:
    plan = db.scalar(
        select(TrainingPlan)
        .where(TrainingPlan.user_id == profile.id)
        .order_by(TrainingPlan.saved_at.desc(), TrainingPlan.id.desc())
        .limit(1)
    )
    latest_plan = None
    if plan is not None:
        document = WeeklyPlanCandidate.model_validate(plan.plan_document)
        movements = {
            movement.id: movement
            for movement in db.scalars(select(Movement).where(Movement.id.in_({
                exercise.movement_id
                for day in document.days
                for exercise in day.exercises
                if exercise.movement_id
            })))
        }
        latest_plan = DashboardPlan(
            id=str(plan.id),
            title=plan.title,
            summary=document.summary,
            saved_at=plan.saved_at,
            days=[
                DashboardPlanDay(
                    day_index=day.day_index,
                    label=day.label,
                    exercises=[
                        DashboardExercise(
                            movement_name=exercise_display_name(exercise, movements),
                            sets=exercise.sets,
                            reps=exercise.reps,
                            hold_seconds=exercise.hold_seconds,
                        )
                        for exercise in day.exercises
                    ],
                )
                for day in document.days
            ],
        )

    context = profile.coaching_context or {}
    availability = context.get("availability") or {}
    return DashboardContext(
        display_name=profile.display_name,
        primary_goal=context.get("primary_goal"),
        days_per_week=availability.get("days_per_week"),
        latest_plan=latest_plan,
    )
