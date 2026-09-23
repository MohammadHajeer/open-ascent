from __future__ import annotations

import copy
import uuid
from datetime import UTC, datetime

from pydantic import ValidationError
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.enums import MovementPrescriptionType
from app.models.movement import Movement
from app.models.movement_documentation import MovementDocumentation
from app.schemas.movement_documentation import (
    MovementDocumentationCreate,
    MovementDocumentationUpdate,
)
from app.schemas.movement_safety import MovementSafetyContent


class MovementNotFoundError(Exception):
    pass


class DocumentationNotFoundError(Exception):
    pass


class DraftAlreadyExistsError(Exception):
    pass


class ImmutableDocumentationError(Exception):
    pass


class InvalidSafetyContentError(Exception):
    pass


class DocumentationRevisionConflictError(Exception):
    pass


class MovementDocumentationService:
    @staticmethod
    def _lock_movement(
        db: Session,
        movement_id: uuid.UUID,
    ) -> Movement:
        movement = db.scalar(
            select(Movement).where(Movement.id == movement_id).with_for_update()
        )

        if movement is None:
            raise MovementNotFoundError

        return movement

    @staticmethod
    def _next_version(
        db: Session,
        movement_id: uuid.UUID,
    ) -> int:
        latest_version = db.scalar(
            select(func.max(MovementDocumentation.version)).where(
                MovementDocumentation.movement_id == movement_id
            )
        )

        return (latest_version or 0) + 1

    @staticmethod
    def _get_current_draft(
        db: Session,
        movement_id: uuid.UUID,
    ) -> MovementDocumentation | None:
        return db.scalar(
            select(MovementDocumentation).where(
                MovementDocumentation.movement_id == movement_id,
                MovementDocumentation.status == "draft",
            )
        )

    @staticmethod
    def _get_current_published(
        db: Session,
        movement_id: uuid.UUID,
    ) -> MovementDocumentation | None:
        return db.scalar(
            select(MovementDocumentation).where(
                MovementDocumentation.movement_id == movement_id,
                MovementDocumentation.status == "published",
            )
        )

    @classmethod
    def create_draft(
        cls,
        db: Session,
        movement_id: uuid.UUID,
        payload: MovementDocumentationCreate,
        actor_id: uuid.UUID,
    ) -> MovementDocumentation:
        cls._lock_movement(db, movement_id)

        if cls._get_current_draft(db, movement_id) is not None:
            raise DraftAlreadyExistsError

        documentation = MovementDocumentation(
            movement_id=movement_id,
            version=cls._next_version(db, movement_id),
            status="draft",
            content=payload.content.model_dump(mode="json", exclude_none=True),
            created_by=actor_id,
            edit_revision=1,
        )

        db.add(documentation)
        db.commit()
        db.refresh(documentation)

        return documentation

    @staticmethod
    def update_draft(
        db: Session,
        documentation_id: uuid.UUID,
        payload: MovementDocumentationUpdate,
    ) -> MovementDocumentation:
        documentation = db.scalar(
            select(MovementDocumentation)
            .where(MovementDocumentation.id == documentation_id)
            .with_for_update()
        )

        if documentation is None:
            raise DocumentationNotFoundError

        if documentation.status != "draft":
            raise ImmutableDocumentationError

        if documentation.edit_revision != payload.edit_revision:
            raise DocumentationRevisionConflictError

        updates = payload.content.model_dump(mode="json", exclude_unset=True)

        if (
            "prerequisites" in updates
            and updates["prerequisites"] != documentation.content.get("prerequisites")
            and updates.get(
                "readiness_rules", documentation.content.get("readiness_rules")
            )
            == documentation.content.get("readiness_rules")
        ):
            # A prose edit may change what an index means. Require rules to be
            # explicitly reauthored before they can confer readiness again.
            updates["readiness_rules"] = None

        documentation.content = {
            **documentation.content,
            **updates,
        }

        documentation.edit_revision += 1

        db.commit()
        db.refresh(documentation)

        return documentation

    @classmethod
    def create_draft_from_published(
        cls,
        db: Session,
        movement_id: uuid.UUID,
        actor_id: uuid.UUID,
    ) -> MovementDocumentation:
        cls._lock_movement(db, movement_id)

        if cls._get_current_draft(db, movement_id) is not None:
            raise DraftAlreadyExistsError

        published = cls._get_current_published(db, movement_id)

        if published is None:
            raise DocumentationNotFoundError

        documentation = MovementDocumentation(
            movement_id=movement_id,
            version=cls._next_version(db, movement_id),
            status="draft",
            content=copy.deepcopy(published.content),
            created_by=actor_id,
            edit_revision=1,
        )

        db.add(documentation)
        db.commit()
        db.refresh(documentation)

        return documentation

    @classmethod
    def publish_draft(
        cls,
        db: Session,
        documentation_id: uuid.UUID,
        actor_id: uuid.UUID,
        expected_revision: int | None = None,
    ) -> MovementDocumentation:
        draft = db.scalar(
            select(MovementDocumentation)
            .where(MovementDocumentation.id == documentation_id)
            .with_for_update()
        )

        if draft is None:
            raise DocumentationNotFoundError

        if draft.status != "draft":
            raise ImmutableDocumentationError

        if expected_revision is not None and draft.edit_revision != expected_revision:
            raise DocumentationRevisionConflictError

        try:
            validated_content = MovementSafetyContent.model_validate(draft.content)
        except ValidationError as exc:
            raise InvalidSafetyContentError from exc

        for rule in validated_content.readiness_rules or []:
            source_movement = db.get(Movement, rule.movement_id)
            expected = (
                MovementPrescriptionType.REPETITIONS
                if rule.metric == "reps"
                else MovementPrescriptionType.DURATION
            )
            if source_movement is None or source_movement.prescription_type != expected:
                raise InvalidSafetyContentError(
                    "Readiness rule movement and metric must match."
                )

        draft.content = validated_content.model_dump(mode="json", exclude_none=True)

        cls._lock_movement(db, draft.movement_id)

        current_published = cls._get_current_published(
            db,
            draft.movement_id,
        )

        if current_published is not None:
            current_published.status = "archived"
            db.flush()

        draft.status = "published"
        draft.published_by = actor_id
        draft.published_at = datetime.now(UTC)

        db.commit()
        db.refresh(draft)

        return draft

    @classmethod
    def get_published(
        cls,
        db: Session,
        movement_id: uuid.UUID,
    ) -> MovementDocumentation | None:
        return cls._get_current_published(db, movement_id)

    @classmethod
    def get_draft(
        cls,
        db: Session,
        movement_id: uuid.UUID,
    ) -> MovementDocumentation | None:
        return cls._get_current_draft(db, movement_id)

    @staticmethod
    def list_versions(
        db: Session,
        movement_id: uuid.UUID,
    ) -> list[MovementDocumentation]:
        return list(
            db.scalars(
                select(MovementDocumentation)
                .where(MovementDocumentation.movement_id == movement_id)
                .order_by(MovementDocumentation.version.desc())
            )
        )
