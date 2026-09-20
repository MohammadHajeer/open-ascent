from __future__ import annotations

from datetime import UTC, datetime

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert

from app.api.dependencies.auth import CurrentUserId
from app.core.safety import CURRENT_SAFETY_ACK_VERSION, GLOBAL_SAFETY_GUIDANCE
from app.db.database import DbSession
from app.models.movement import Movement
from app.models.profile import Profile
from app.schemas.onboarding import (
    CatalogMovement,
    OnboardingConfig,
    OnboardingResult,
    OnboardingSubmit,
)
from app.services.onboarding import build_assessment, derive_athlete_state

router = APIRouter(prefix="/profiles/onboarding", tags=["profiles"])
SKILL_SLUGS = frozenset({"muscle-up", "front-lever", "back-lever"})


@router.get("/config", response_model=OnboardingConfig)
def get_onboarding_config(_user_id: CurrentUserId, db: DbSession) -> OnboardingConfig:
    movements = db.scalars(select(Movement).order_by(Movement.name)).all()
    return OnboardingConfig(
        safety_version=CURRENT_SAFETY_ACK_VERSION,
        safety_guidance=GLOBAL_SAFETY_GUIDANCE,
        skill_movements=[
            CatalogMovement(id=item.id, name=item.name)
            for item in movements
            if item.slug in SKILL_SLUGS
        ],
        avoidance_movements=[
            CatalogMovement(id=item.id, name=item.name) for item in movements
        ],
    )


def _result(profile: Profile) -> OnboardingResult:
    return OnboardingResult(
        display_name=profile.display_name,
        onboarding_completed_at=profile.onboarding_completed_at,
    )


def _completed_response(profile: Profile, payload: OnboardingSubmit) -> OnboardingResult:
    expected_context = payload.coaching_context.model_dump(mode="json") | {
        "schema_version": 1
    }
    if (
        profile.display_name == payload.display_name
        and profile.coaching_context == expected_context
        and profile.initial_assessment.get("answers")
        == payload.assessment.model_dump(mode="json")
        and profile.safety_ack_version == payload.safety.version
    ):
        return _result(profile)
    raise HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail="Onboarding is already complete. The original assessment cannot be replaced.",
    )


@router.post("", response_model=OnboardingResult)
def complete_onboarding(
    payload: OnboardingSubmit,
    user_id: CurrentUserId,
    db: DbSession,
) -> OnboardingResult:
    if payload.safety.version != CURRENT_SAFETY_ACK_VERSION:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Safety guidance has changed. Review the current version.",
        )

    profile = db.scalar(select(Profile).where(Profile.id == user_id).with_for_update())
    if profile is not None:
        if profile.app_role != "athlete":
            raise HTTPException(status_code=403, detail="Athlete access required.")
        if profile.onboarding_completed_at is not None:
            return _completed_response(profile, payload)

    selected_ids = set(payload.coaching_context.avoid_movement_ids)
    skill = payload.assessment.skill_progression
    if skill is not None:
        selected_ids.add(skill.movement_id)
    movements = (
        {
            item.id: item
            for item in db.scalars(select(Movement).where(Movement.id.in_(selected_ids)))
        }
        if selected_ids
        else {}
    )
    if selected_ids - movements.keys():
        raise HTTPException(status_code=422, detail="Unknown catalog movement.")
    if skill is not None and movements[skill.movement_id].slug not in SKILL_SLUGS:
        raise HTTPException(status_code=422, detail="Invalid skill progression movement.")

    if profile is None:
        db.execute(
            insert(Profile)
            .values(id=user_id, display_name=payload.display_name)
            .on_conflict_do_nothing(index_elements=[Profile.id])
        )
        profile = db.scalar(select(Profile).where(Profile.id == user_id).with_for_update())
        if profile is None:
            raise HTTPException(status_code=500, detail="Profile could not be created.")
        if profile.app_role != "athlete":
            raise HTTPException(status_code=403, detail="Athlete access required.")
        if profile.onboarding_completed_at is not None:
            return _completed_response(profile, payload)

    now = datetime.now(UTC)
    initial_assessment = build_assessment(payload.assessment, now)
    profile.display_name = payload.display_name
    profile.coaching_context = payload.coaching_context.model_dump(mode="json") | {
        "schema_version": 1
    }
    profile.initial_assessment = initial_assessment
    profile.athlete_state = derive_athlete_state(initial_assessment)
    profile.safety_ack_version = CURRENT_SAFETY_ACK_VERSION
    profile.safety_acknowledged_at = now
    profile.onboarding_completed_at = now
    db.commit()
    return _result(profile)
