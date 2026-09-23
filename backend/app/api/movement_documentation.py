from __future__ import annotations

import uuid

from fastapi import APIRouter, HTTPException, Query, status
from pydantic import ValidationError
from sqlalchemy import func, select

from app.api.dependencies.auth import AdminProfile
from app.db.database import DbSession
from app.models.movement import Movement
from app.models.movement_documentation import MovementDocumentation
from app.schemas.movement_documentation import (
    MovementDocumentationCreate,
    MovementDocumentationPublish,
    MovementDocumentationRead,
    MovementDocumentationUpdate,
)
from app.services.movement_documentation import (
    DocumentationNotFoundError,
    DocumentationRevisionConflictError,
    DraftAlreadyExistsError,
    ImmutableDocumentationError,
    InvalidSafetyContentError,
    MovementDocumentationService,
    MovementNotFoundError,
)

router = APIRouter(
    prefix="/movements",
    tags=["movement documentation"],
)


# ------------------------------------------------------------------
# Admin — create draft
# ------------------------------------------------------------------


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


# ------------------------------------------------------------------
# Admin — update draft
# ------------------------------------------------------------------


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

    except DocumentationRevisionConflictError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This draft changed in another session. Reload it before saving.",
        ) from exc


# ------------------------------------------------------------------
# Admin — create new draft from published version
# ------------------------------------------------------------------


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


# ------------------------------------------------------------------
# Admin — publish draft
# ------------------------------------------------------------------


@router.post(
    "/documentation/{documentation_id}/publish",
    response_model=MovementDocumentationRead,
)
def publish_draft(
    documentation_id: uuid.UUID,
    payload: MovementDocumentationPublish,
    db: DbSession,
    admin: AdminProfile,
) -> MovementDocumentationRead:
    try:
        return MovementDocumentationService.publish_draft(
            db=db,
            documentation_id=documentation_id,
            actor_id=admin.id,
            expected_revision=payload.edit_revision,
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

    except InvalidSafetyContentError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Safety documentation is incomplete or invalid.",
        ) from exc

    except DocumentationRevisionConflictError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This draft changed in another session. Reload it before publishing.",
        ) from exc


@router.get("/documentation/admin")
def list_admin_documentation(
    db: DbSession,
    _admin: AdminProfile,
    page: int = Query(1, ge=1, le=1000),
    page_size: int = Query(20, ge=1, le=100),
    status_filter: str | None = Query(
        None, alias="status", pattern="^(draft|published|archived)$"
    ),
    movement_id: uuid.UUID | None = None,
    q: str | None = Query(None, max_length=80),
):
    conditions = []
    if status_filter:
        conditions.append(MovementDocumentation.status == status_filter)
    if movement_id:
        conditions.append(MovementDocumentation.movement_id == movement_id)
    if q and q.strip():
        escaped = (
            q.strip().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        )
        conditions.append(Movement.name.ilike(f"%{escaped}%", escape="\\"))
    total = (
        db.scalar(
            select(func.count())
            .select_from(MovementDocumentation)
            .join(Movement, Movement.id == MovementDocumentation.movement_id)
            .where(*conditions)
        )
        or 0
    )
    rows = db.execute(
        select(
            MovementDocumentation.id,
            MovementDocumentation.movement_id,
            MovementDocumentation.version,
            MovementDocumentation.status,
            MovementDocumentation.edit_revision,
            MovementDocumentation.updated_at,
            MovementDocumentation.published_at,
            Movement.id,
            Movement.name,
            Movement.slug,
            Movement.family_key,
        )
        .join(Movement, Movement.id == MovementDocumentation.movement_id)
        .where(*conditions)
        .order_by(
            MovementDocumentation.updated_at.desc(), MovementDocumentation.id.desc()
        )
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    return {
        "page": page,
        "page_size": page_size,
        "total": total,
        "items": [
            {
                "id": doc_id,
                "movement_id": doc_movement_id,
                "version": version,
                "status": doc_status,
                "edit_revision": revision,
                "updated_at": updated,
                "published_at": published,
                "movement": {
                    "id": mid,
                    "name": name,
                    "slug": slug,
                    "family_key": family,
                },
            }
            for doc_id, doc_movement_id, version, doc_status, revision, updated, published, mid, name, slug, family in rows
        ],
    }


@router.get("/documentation/admin/{documentation_id}")
def get_admin_documentation(
    documentation_id: uuid.UUID,
    db: DbSession,
    _admin: AdminProfile,
):
    row = db.execute(
        select(MovementDocumentation, Movement)
        .join(Movement, Movement.id == MovementDocumentation.movement_id)
        .where(MovementDocumentation.id == documentation_id)
    ).one_or_none()
    if row is None:
        raise HTTPException(404, "Documentation not found.")
    documentation, movement = row
    try:
        record = MovementDocumentationRead.model_validate(documentation).model_dump(
            mode="json"
        )
    except ValidationError as exc:
        raise HTTPException(
            422, "This documentation version has invalid content."
        ) from exc
    return {
        **record,
        "movement": {
            "id": movement.id,
            "name": movement.name,
            "slug": movement.slug,
            "family_key": movement.family_key,
        },
    }


# ------------------------------------------------------------------
# Admin — published documentation by movement UUID
# ------------------------------------------------------------------


@router.get(
    "/id/{movement_id}/documentation/published",
    response_model=MovementDocumentationRead,
)
def get_published(
    movement_id: uuid.UUID,
    db: DbSession,
    admin: AdminProfile,
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


# ------------------------------------------------------------------
# Admin — current draft
# ------------------------------------------------------------------


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


# ------------------------------------------------------------------
# Admin — documentation version history
# ------------------------------------------------------------------


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
