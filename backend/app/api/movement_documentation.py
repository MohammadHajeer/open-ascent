from __future__ import annotations

import uuid

from app.api.dependencies.auth import AdminProfile
from app.db.database import DbSession
from app.schemas.movement_documentation import (
    MovementDocumentationCreate,
    MovementDocumentationRead,
    MovementDocumentationUpdate,
)
from app.services.movement_documentation import (
    DocumentationNotFoundError,
    DraftAlreadyExistsError,
    ImmutableDocumentationError,
    MovementDocumentationService,
    MovementNotFoundError,
)
from fastapi import APIRouter, HTTPException, status

router = APIRouter(
    prefix="/movements",
    tags=["movement documentation"],
)


@router.post(
    "/{movement_id}/documentation/draft",
    response_model=MovementDocumentationRead,
    status_code=status.HTTP_201_CREATED,
)
def create_draft(
    movement_id: uuid.UUID,
    payload: MovementDocumentationCreate,
    db: DbSession,
    admin: AdminProfile,
) -> MovementDocumentationRead:
    try:
        return MovementDocumentationService.create_draft(
            db=db,
            movement_id=movement_id,
            payload=payload,
            actor_id=admin.id,
        )
    except MovementNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Movement not found.",
        ) from exc
    except DraftAlreadyExistsError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A draft already exists for this movement.",
        ) from exc


@router.patch(
    "/documentation/{documentation_id}",
    response_model=MovementDocumentationRead,
)
def update_draft(
    documentation_id: uuid.UUID,
    payload: MovementDocumentationUpdate,
    db: DbSession,
    admin: AdminProfile,
) -> MovementDocumentationRead:
    try:
        return MovementDocumentationService.update_draft(
            db=db,
            documentation_id=documentation_id,
            payload=payload,
        )
    except DocumentationNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Documentation not found.",
        ) from exc
    except ImmutableDocumentationError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Published or archived documentation cannot be edited.",
        ) from exc


@router.post(
    "/{movement_id}/documentation/draft-from-published",
    response_model=MovementDocumentationRead,
    status_code=status.HTTP_201_CREATED,
)
def create_draft_from_published(
    movement_id: uuid.UUID,
    db: DbSession,
    admin: AdminProfile,
) -> MovementDocumentationRead:
    try:
        return MovementDocumentationService.create_draft_from_published(
            db=db,
            movement_id=movement_id,
            actor_id=admin.id,
        )
    except MovementNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Movement not found.",
        ) from exc
    except DocumentationNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Published documentation not found.",
        ) from exc
    except DraftAlreadyExistsError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A draft already exists for this movement.",
        ) from exc


@router.post(
    "/documentation/{documentation_id}/publish",
    response_model=MovementDocumentationRead,
)
def publish_draft(
    documentation_id: uuid.UUID,
    db: DbSession,
    admin: AdminProfile,
) -> MovementDocumentationRead:
    try:
        return MovementDocumentationService.publish_draft(
            db=db,
            documentation_id=documentation_id,
            actor_id=admin.id,
        )
    except DocumentationNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Documentation not found.",
        ) from exc
    except ImmutableDocumentationError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Only draft documentation can be published.",
        ) from exc


@router.get(
    "/{movement_id}/documentation/published",
    response_model=MovementDocumentationRead,
)
def get_published(
    movement_id: uuid.UUID,
    db: DbSession,
) -> MovementDocumentationRead:
    documentation = MovementDocumentationService.get_published(
        db=db,
        movement_id=movement_id,
    )

    if documentation is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Published documentation not found.",
        )

    return documentation


@router.get(
    "/{movement_id}/documentation/draft",
    response_model=MovementDocumentationRead,
)
def get_draft(
    movement_id: uuid.UUID,
    db: DbSession,
    admin: AdminProfile,
) -> MovementDocumentationRead:
    documentation = MovementDocumentationService.get_draft(
        db=db,
        movement_id=movement_id,
    )

    if documentation is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Draft documentation not found.",
        )

    return documentation


@router.get(
    "/{movement_id}/documentation/versions",
    response_model=list[MovementDocumentationRead],
)
def list_versions(
    movement_id: uuid.UUID,
    db: DbSession,
    admin: AdminProfile,
) -> list[MovementDocumentationRead]:
    return MovementDocumentationService.list_versions(
        db=db,
        movement_id=movement_id,
    )
