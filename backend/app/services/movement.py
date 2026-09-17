from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.movement import Movement
from app.models.movement_documentation import MovementDocumentation


class MovementNotFoundError(Exception):
    pass


class PublishedDocumentationNotFoundError(Exception):
    pass


class MovementService:
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
