"""Owner-scoped athlete profile read for the authenticated workspace."""

from fastapi import APIRouter
from pydantic import BaseModel

from app.api.dependencies.auth import AthleteProfile
from app.db.database import DbSession
from app.services.coach_context import get_athlete_profile_context

router = APIRouter(prefix="/athlete-profile", tags=["athlete-profile"])


class AthleteProfileRead(BaseModel):
    display_name: str
    context: dict


@router.get("/me", response_model=AthleteProfileRead)
def get_my_athlete_profile(profile: AthleteProfile, db: DbSession) -> AthleteProfileRead:
    return AthleteProfileRead(
        display_name=profile.display_name,
        context=get_athlete_profile_context(db, profile.id) or {},
    )
