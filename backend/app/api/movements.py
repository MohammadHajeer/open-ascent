from fastapi import APIRouter, HTTPException

from app.db.database import DbSession
from app.schemas.movement import (
    MovementGuideRead,
    MovementListItemRead,
)
from app.schemas.movement_documentation import MovementDocumentationRead
from app.schemas.movement_safety import MovementSafetyContent
from app.services.movement import (
    MovementNotFoundError,
    MovementService,
    PublishedDocumentationNotFoundError,
    get_illustration_url,
)

router = APIRouter(prefix="/movements", tags=["movements"])


@router.get("", response_model=list[MovementListItemRead])
def list_movements(db: DbSession) -> list[MovementListItemRead]:
    guides = MovementService.list_public_guides(db)

    return [
        MovementListItemRead(
            id=movement.id,
            slug=movement.slug,
            name=movement.name,
            family_key=movement.family_key,
            difficulty=MovementSafetyContent.model_validate(
                documentation.content
            ).difficulty,
            illustration_url=get_illustration_url(movement.illustration_path),
            upload_analysis_supported=movement.upload_analysis_supported,
            live_coach_supported=movement.live_coach_supported,
        )
        for movement, documentation in guides
    ]


@router.get("/{slug}", response_model=MovementGuideRead)
def get_movement_guide(
    slug: str,
    db: DbSession,
) -> MovementGuideRead:
    try:
        movement, documentation = MovementService.get_public_guide(
            db=db,
            slug=slug,
        )
    except MovementNotFoundError as exc:
        raise HTTPException(
            status_code=404,
            detail="Movement not found.",
        ) from exc
    except PublishedDocumentationNotFoundError as exc:
        raise HTTPException(
            status_code=404,
            detail="Published guide not found.",
        ) from exc

    return MovementGuideRead(
        id=movement.id,
        slug=movement.slug,
        name=movement.name,
        family_key=movement.family_key,
        illustration_url=get_illustration_url(movement.illustration_path),
        upload_analysis_supported=movement.upload_analysis_supported,
        live_coach_supported=movement.live_coach_supported,
        documentation=MovementDocumentationRead.model_validate(documentation),
    )
