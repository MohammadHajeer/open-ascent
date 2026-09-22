from __future__ import annotations

import uuid
from datetime import date, datetime

from sqlalchemy import (
    Date,
    DateTime,
    ForeignKey,
    Index,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class GuestAnalysisUsage(Base):
    """Durable admission record for one accepted guest analysis."""

    __tablename__ = "guest_analysis_usage"
    __table_args__ = (
        UniqueConstraint("analysis_id", name="uq_guest_analysis_usage_analysis"),
        UniqueConstraint(
            "usage_date",
            "guest_identity_key",
            name="uq_guest_analysis_usage_identity_day",
        ),
        Index("ix_guest_analysis_usage_date", "usage_date"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    analysis_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("analyses.id", ondelete="CASCADE"),
        nullable=False,
    )
    usage_date: Mapped[date] = mapped_column(Date, nullable=False)
    guest_identity_key: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
