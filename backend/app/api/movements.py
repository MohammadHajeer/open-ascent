from fastapi import APIRouter, HTTPException, status

from app.core.config import settings
from app.db.database import DbSession
from app.schemas.movement import MovementGuideRead
from app.schemas.movement_documentation import MovementDocumentationRead
from app.services.movement import (
    MovementNotFoundError,
    MovementService,
    PublishedDocumentationNotFoundError,
)

router = APIRouter(
    prefix="/movements",
    tags=["movements"],
)


@router.get(
    "/{slug}",
    response_model=MovementGuideRead,
)
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
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Movement not found.",
        ) from exc

    except PublishedDocumentationNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Published guide not found.",
        ) from exc

    illustration_url = None

    if movement.illustration_path:
        illustration_url = (
            f"{settings.supabase_url}"
            f"/storage/v1/object/public/"
            f"movement-illustrations/"
            f"{movement.illustration_path}"
        )

    return MovementGuideRead(
        id=movement.id,
        slug=movement.slug,
        name=movement.name,
        family_key=movement.family_key,
        illustration_url=illustration_url,
        upload_analysis_supported=movement.upload_analysis_supported,
        live_coach_supported=movement.live_coach_supported,
        documentation=MovementDocumentationRead.model_validate(documentation),
    )
