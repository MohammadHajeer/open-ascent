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
    text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.models.mixins import TimestampMixin


class Analysis(TimestampMixin, Base):
    __tablename__ = "analyses"
    __table_args__ = (
        CheckConstraint(
            "owner_kind IN ('guest', 'authenticated')", name="ck_analyses_owner_kind"
        ),
        CheckConstraint(
            "status IN ('reserved', 'queued', 'running', 'completed', 'failed', 'expired')",
            name="ck_analyses_status",
        ),
        CheckConstraint(
            "ai_feedback_status IN ('pending', 'running', 'completed', 'failed', 'skipped')",
            name="ck_analyses_ai_feedback_status",
        ),
        CheckConstraint("attempts >= 0", name="ck_analyses_attempts"),
        CheckConstraint(
            "ai_feedback_attempts >= 0", name="ck_analyses_ai_feedback_attempts"
        ),
        CheckConstraint(
            "ai_feedback_status <> 'running' OR "
            "(ai_feedback_claim_token IS NOT NULL AND ai_feedback_lease_expires_at IS NOT NULL)",
            name="ck_analyses_ai_feedback_running_claim",
        ),
        CheckConstraint(
            """
            (
                owner_kind = 'guest'
                AND user_id IS NULL
                AND guest_token_hash IS NOT NULL
                AND guest_rate_key IS NOT NULL
                AND access_expires_at IS NOT NULL
                AND purge_after IS NOT NULL
                AND feature_usage_id IS NULL
            )
            OR
            (
                owner_kind = 'authenticated'
                AND user_id IS NOT NULL
                AND guest_token_hash IS NULL
                AND guest_rate_key IS NULL
                AND access_expires_at IS NULL
                AND purge_after IS NULL
            )
            """,
            name="ck_analyses_ownership_shape",
        ),
        CheckConstraint(
            "status <> 'running' OR (claim_token IS NOT NULL AND lease_expires_at IS NOT NULL)",
            name="ck_analyses_running_claim",
        ),
        Index("ix_analyses_worker_queue", "status", "created_at"),
        Index("ix_analyses_guest_abuse_window", "guest_rate_key", "created_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("profiles.id", ondelete="CASCADE"),
        nullable=True,
    )
    movement_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("movements.id", ondelete="RESTRICT"),
        nullable=False,
    )
    safety_documentation_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("movement_documentation.id", ondelete="RESTRICT"),
        nullable=False,
    )
    safety_ack_version: Mapped[str] = mapped_column(Text, nullable=False)
    safety_acknowledged_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
    )
    feature_usage_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("feature_usage.id", ondelete="SET NULL"),
        nullable=True,
        unique=True,
    )
    owner_kind: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(
        Text, nullable=False, server_default=text("'reserved'")
    )
    stage: Mapped[str] = mapped_column(
        Text, nullable=False, server_default=text("'reserved'")
    )
    video_path: Mapped[str | None] = mapped_column(Text, nullable=True)
    guest_token_hash: Mapped[str | None] = mapped_column(Text, nullable=True)
    guest_rate_key: Mapped[str | None] = mapped_column(Text, nullable=True)
    reservation_operation_key: Mapped[str] = mapped_column(
        Text, nullable=False, unique=True
    )
    request_fingerprint: Mapped[str] = mapped_column(Text, nullable=False)
    reservation_expires_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
    )
    access_expires_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    video_delete_after: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    purge_after: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    attempts: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=text("0")
    )
    claim_token: Mapped[str | None] = mapped_column(Text, nullable=True)
    lease_expires_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    error_code: Mapped[str | None] = mapped_column(Text, nullable=True)
    progress_snapshot: Mapped[dict] = mapped_column(
        JSONB,
        nullable=False,
        server_default=text("'{}'::jsonb"),
    )
    result: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    ai_feedback_status: Mapped[str] = mapped_column(
        Text,
        nullable=False,
        server_default=text("'pending'"),
    )
    ai_explanation: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    ai_feedback_attempts: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=text("0")
    )
    ai_feedback_claim_token: Mapped[str | None] = mapped_column(Text, nullable=True)
    ai_feedback_lease_expires_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    analyzer_version: Mapped[str | None] = mapped_column(Text, nullable=True)
    model_version: Mapped[str | None] = mapped_column(Text, nullable=True)
