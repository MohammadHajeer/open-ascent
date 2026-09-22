from fastapi import APIRouter

from app.api.dependencies.auth import AthleteProfile
from app.db.database import DbSession
from app.schemas.progress import ProgressSummary
from app.services.progress import get_progress_summary

router = APIRouter(prefix="/progress", tags=["progress"])


@router.get("/summary", response_model=ProgressSummary)
def read_progress_summary(
    profile: AthleteProfile,
    db: DbSession,
) -> ProgressSummary:
    return get_progress_summary(db, profile.id)
