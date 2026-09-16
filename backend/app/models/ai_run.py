from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Numeric, Text, text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.models.mixins import TimestampMixin


class AIRun(TimestampMixin, Base):
    __tablename__ = "ai_runs"
    __table_args__ = (
        CheckConstraint(
            "status IN ('reserved', 'running', 'completed', 'failed', 'interrupted')",
            name="ck_ai_runs_status",
        ),
        CheckConstraint("reserved_cost >= 0", name="ck_ai_runs_reserved_cost"),
        CheckConstraint(
            "actual_cost IS NULL OR actual_cost >= 0", name="ck_ai_runs_actual_cost"
        ),
        CheckConstraint(
            """
            (temporary_result IS NULL AND result_expires_at IS NULL)
            OR (temporary_result IS NOT NULL AND result_expires_at IS NOT NULL)
            """,
            name="ck_ai_runs_temporary_result_expiry",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("profiles.id", ondelete="SET NULL"),
        nullable=True,
    )
    analysis_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("analyses.id", ondelete="SET NULL"),
        nullable=True,
    )
    feature_usage_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("feature_usage.id", ondelete="SET NULL"),
        nullable=True,
    )
    feature: Mapped[str] = mapped_column(Text, nullable=False)
    provider: Mapped[str] = mapped_column(Text, nullable=False)
    model: Mapped[str] = mapped_column(Text, nullable=False)
    operation_key: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    status: Mapped[str] = mapped_column(
        Text, nullable=False, server_default=text("'reserved'")
    )
    reserved_cost: Mapped[Decimal] = mapped_column(Numeric(14, 6), nullable=False)
    actual_cost: Mapped[Decimal | None] = mapped_column(Numeric(14, 6), nullable=True)
    usage: Mapped[dict] = mapped_column(
        JSONB, nullable=False, server_default=text("'{}'::jsonb")
    )
    metadata_json: Mapped[dict] = mapped_column(
        "metadata",
        JSONB,
        nullable=False,
        server_default=text("'{}'::jsonb"),
    )
    temporary_result: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    result_expires_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
