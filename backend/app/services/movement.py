from __future__ import annotations

import uuid

from sqlalchemy import and_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.movement import Movement
from app.models.movement_documentation import MovementDocumentation
from app.schemas.movement import MovementCreate, MovementUpdate

MOVEMENT_ILLUSTRATIONS_BUCKET = "movement-illustrations"


def get_illustration_url(path: str | None) -> str | None:
    if path is None:
        return None

    return (
        f"{settings.supabase_url}"
        f"/storage/v1/object/public/"
        f"{MOVEMENT_ILLUSTRATIONS_BUCKET}/"
        f"{path}"
    )


class MovementNotFoundError(Exception):
    pass


class PublishedDocumentationNotFoundError(Exception):
    pass


class MovementSlugAlreadyExistsError(Exception):
    pass


class MovementService:
    @staticmethod
    def list_admin_movements(
        db: Session,
    ) -> list[tuple[Movement, MovementDocumentation | None]]:
        statement = (
            select(Movement, MovementDocumentation)
            .outerjoin(
                MovementDocumentation,
                and_(
                    MovementDocumentation.movement_id == Movement.id,
                    MovementDocumentation.status == "published",
                ),
            )
            .order_by(Movement.name)
        )

        return list(db.execute(statement))

    @staticmethod
    def get_admin_movement(
        db: Session,
        slug: str,
    ) -> tuple[Movement, MovementDocumentation | None]:
        statement = (
            select(Movement, MovementDocumentation)
            .outerjoin(
                MovementDocumentation,
                and_(
                    MovementDocumentation.movement_id == Movement.id,
                    MovementDocumentation.status == "published",
                ),
            )
            .where(Movement.slug == slug)
        )
        result = db.execute(statement).first()

        if result is None:
            raise MovementNotFoundError

        return result

    @staticmethod
    def create(
        db: Session,
        payload: MovementCreate,
    ) -> Movement:
        if db.scalar(select(Movement.id).where(Movement.slug == payload.slug)):
            raise MovementSlugAlreadyExistsError

        movement = Movement(
            name=payload.name,
            slug=payload.slug,
            family_key=payload.family_key,
            illustration_path=payload.illustration_path,
            upload_analysis_supported=payload.upload_analysis_supported,
            live_coach_supported=payload.live_coach_supported,
        )
        db.add(movement)

        try:
            db.commit()
        except IntegrityError as exc:
            db.rollback()
            if "slug" in str(exc).lower():
                raise MovementSlugAlreadyExistsError from exc
            raise

        db.refresh(movement)
        return movement

    @staticmethod
    def update(
        db: Session,
        movement_id: uuid.UUID,
        payload: MovementUpdate,
    ) -> Movement:
        movement = db.scalar(
            select(Movement).where(Movement.id == movement_id).with_for_update()
        )

        if movement is None:
            raise MovementNotFoundError

        updates = payload.model_dump(exclude_unset=True)
        next_slug = updates.get("slug")
        if (
            next_slug is not None
            and next_slug != movement.slug
            and db.scalar(
                select(Movement.id).where(
                    Movement.slug == next_slug,
                    Movement.id != movement.id,
                )
            )
        ):
            raise MovementSlugAlreadyExistsError

        for field, value in updates.items():
            setattr(movement, field, value)

        try:
            db.commit()
        except IntegrityError as exc:
            db.rollback()
            if "slug" in str(exc).lower():
                raise MovementSlugAlreadyExistsError from exc
            raise

        db.refresh(movement)
        return movement

    @staticmethod
    def list_public_guides(
        db: Session,
    ) -> list[tuple[Movement, MovementDocumentation]]:
        statement = (
            select(Movement, MovementDocumentation)
            .join(
                MovementDocumentation,
                MovementDocumentation.movement_id == Movement.id,
            )
            .where(MovementDocumentation.status == "published")
            .order_by(Movement.name)
        )

        return [
            (movement, documentation)
            for movement, documentation in db.execute(statement)
        ]

    @staticmethod
    def get_public_guide(
        db: Session,
        slug: str,
    ) -> tuple[Movement, MovementDocumentation]:
        movement = db.scalar(
            select(Movement).where(
                Movement.slug == slug,
            )
        )

        if movement is None:
            raise MovementNotFoundError

        documentation = db.scalar(
            select(MovementDocumentation).where(
                MovementDocumentation.movement_id == movement.id,
                MovementDocumentation.status == "published",
            )
        )

        if documentation is None:
            raise PublishedDocumentationNotFoundError

        return movement, documentation
