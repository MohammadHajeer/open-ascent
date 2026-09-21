import uuid

from fastapi import APIRouter, HTTPException, status

from app.api.dependencies.auth import AdminProfile
from app.db.database import DbSession
from app.schemas.movement import (
    MovementAdminRead,
    MovementCreate,
    MovementGuideRead,
    MovementListItemRead,
    MovementUpdate,
)
from app.schemas.movement_documentation import MovementDocumentationRead
from app.schemas.movement_safety import MovementSafetyContent
from app.services.movement import (
    MovementNotFoundError,
    MovementService,
    MovementSlugAlreadyExistsError,
    PublishedDocumentationNotFoundError,
    get_illustration_url,
)

router = APIRouter(prefix="/movements", tags=["movements"])


def _admin_read(
    movement,
    documentation,
) -> MovementAdminRead:
    return MovementAdminRead(
        id=movement.id,
        slug=movement.slug,
        name=movement.name,
        family_key=movement.family_key,
        illustration_path=movement.illustration_path,
        illustration_url=get_illustration_url(movement.illustration_path),
        upload_analysis_supported=movement.upload_analysis_supported,
        live_coach_supported=movement.live_coach_supported,
        difficulty=(
            MovementSafetyContent.model_validate(documentation.content).difficulty
            if documentation is not None
            else None
        ),
        published_documentation_id=(documentation.id if documentation else None),
        published_documentation_version=(
            documentation.version if documentation else None
        ),
    )


# ------------------------------------------------------------------
# Admin — movement catalog
# ------------------------------------------------------------------


@router.get("/admin", response_model=list[MovementAdminRead])
def list_admin_movements(
    db: DbSession,
    _admin: AdminProfile,
) -> list[MovementAdminRead]:
    return [
        _admin_read(movement, documentation)
        for movement, documentation in MovementService.list_admin_movements(db)
    ]


@router.get("/admin/{slug}", response_model=MovementAdminRead)
def get_admin_movement(
    slug: str,
    db: DbSession,
    _admin: AdminProfile,
) -> MovementAdminRead:
    try:
        movement, documentation = MovementService.get_admin_movement(db=db, slug=slug)
    except MovementNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Movement not found.",
        ) from exc

    return _admin_read(movement, documentation)


@router.post("", response_model=MovementAdminRead, status_code=status.HTTP_201_CREATED)
def create_movement(
    payload: MovementCreate,
    db: DbSession,
    _admin: AdminProfile,
) -> MovementAdminRead:
    try:
        movement = MovementService.create(db=db, payload=payload)
    except MovementSlugAlreadyExistsError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A movement with this slug already exists.",
        ) from exc

    return _admin_read(movement, None)


@router.patch("/{movement_id}", response_model=MovementAdminRead)
def update_movement(
    movement_id: uuid.UUID,
    payload: MovementUpdate,
    db: DbSession,
    _admin: AdminProfile,
) -> MovementAdminRead:
    try:
        movement = MovementService.update(
            db=db,
            movement_id=movement_id,
            payload=payload,
        )
        _, documentation = MovementService.get_admin_movement(
            db=db,
            slug=movement.slug,
        )
    except MovementNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Movement not found.",
        ) from exc
    except MovementSlugAlreadyExistsError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A movement with this slug already exists.",
        ) from exc

    return _admin_read(movement, documentation)


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
