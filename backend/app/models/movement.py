from __future__ import annotations

import uuid

from sqlalchemy import Boolean, CheckConstraint, Text, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.models.mixins import TimestampMixin


class Movement(TimestampMixin, Base):
    __tablename__ = "movements"
    __table_args__ = (
        CheckConstraint(
            "prescription_type IN ('repetitions', 'duration')",
            name="ck_movements_prescription_type",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    slug: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    family_key: Mapped[str] = mapped_column(Text, nullable=False)
    # Legacy/admin-created movements stay unclassified until explicitly reviewed.
    # Plan prescriptions must reject NULL rather than infer from the name.
    prescription_type: Mapped[str | None] = mapped_column(Text, nullable=True)
    illustration_path: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
    )
    upload_analysis_supported: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        server_default=text("false"),
    )
    live_coach_supported: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        server_default=text("false"),
    )
