from typing import Literal

from fastapi import APIRouter
from pydantic import BaseModel, ConfigDict
from sqlalchemy import select

from app.api.dependencies.auth import AthleteProfile
from app.db.database import DbSession
from app.models.profile import Profile

router = APIRouter(prefix="/profiles/me/dashboard-tour", tags=["profiles"])

TourStatus = Literal["not_started", "completed", "dismissed"]


class DashboardTourState(BaseModel):
    status: TourStatus


class DashboardTourDecision(BaseModel):
    model_config = ConfigDict(extra="forbid")
    status: Literal["completed", "dismissed"]


@router.get("", response_model=DashboardTourState)
def get_dashboard_tour(profile: AthleteProfile) -> DashboardTourState:
    return DashboardTourState(status=profile.dashboard_tour_status)


@router.put("", response_model=DashboardTourState)
def decide_dashboard_tour(
    decision: DashboardTourDecision, profile: AthleteProfile, db: DbSession
) -> DashboardTourState:
    # Replays are local UI actions; only the first decision persists.
    locked = db.scalar(select(Profile).where(Profile.id == profile.id).with_for_update())
    if locked is not None and locked.dashboard_tour_status == "not_started":
        locked.dashboard_tour_status = decision.status
        db.commit()
    return DashboardTourState(status=locked.dashboard_tour_status if locked else profile.dashboard_tour_status)
