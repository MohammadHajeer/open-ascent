from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.movement import Movement
from app.models.movement_documentation import MovementDocumentation

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


class MovementService:
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
