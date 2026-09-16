from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.models.mixins import TimestampMixin


class MovementDocumentation(TimestampMixin, Base):
    __tablename__ = "movement_documentation"
    __table_args__ = (
        UniqueConstraint(
            "movement_id",
            "version",
            name="uq_movement_documentation_movement_version",
        ),
        CheckConstraint("version > 0", name="ck_movement_documentation_version"),
        CheckConstraint(
            "edit_revision > 0",
            name="ck_movement_documentation_edit_revision",
        ),
        CheckConstraint(
            "status IN ('draft', 'published', 'archived')",
            name="ck_movement_documentation_status",
        ),
        CheckConstraint(
            """
            (status = 'draft' AND published_by IS NULL AND published_at IS NULL)
            OR (status = 'published' AND published_at IS NOT NULL)
            OR (status = 'archived')
            """,
            name="ck_movement_documentation_publication_state",
        ),
        Index(
            "uq_movement_documentation_one_draft",
            "movement_id",
            unique=True,
            postgresql_where=text("status = 'draft'"),
        ),
        Index(
            "uq_movement_documentation_one_published",
            "movement_id",
            unique=True,
            postgresql_where=text("status = 'published'"),
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    movement_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("movements.id", ondelete="RESTRICT"),
        nullable=False,
    )
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[str] = mapped_column(
        Text,
        nullable=False,
        server_default=text("'draft'"),
    )
    content: Mapped[dict] = mapped_column(JSONB, nullable=False)
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("profiles.id", ondelete="SET NULL"),
        nullable=True,
    )
    published_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("profiles.id", ondelete="SET NULL"),
        nullable=True,
    )
    published_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    edit_revision: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        server_default=text("1"),
    )
