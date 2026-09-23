from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Text, text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.db.external import auth_users as _auth_users  # noqa: F401
from app.models.mixins import TimestampMixin


class Profile(TimestampMixin, Base):
    __tablename__ = "profiles"
    __table_args__ = (
        CheckConstraint(
            "app_role IN ('athlete', 'admin')",
            name="ck_profiles_app_role",
        ),
        CheckConstraint(
            "dashboard_tour_status IN ('not_started', 'completed', 'dismissed')",
            name="ck_profiles_dashboard_tour_status",
        ),
        CheckConstraint(
            """
            (safety_ack_version IS NULL AND safety_acknowledged_at IS NULL)
            OR
            (safety_ack_version IS NOT NULL AND safety_acknowledged_at IS NOT NULL)
            """,
            name="ck_profiles_safety_ack_pair",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("auth.users.id", ondelete="CASCADE"),
        primary_key=True,
    )
    display_name: Mapped[str] = mapped_column(Text, nullable=False)
    app_role: Mapped[str] = mapped_column(
        Text,
        nullable=False,
        server_default=text("'athlete'"),
    )
    onboarding_completed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    dashboard_tour_status: Mapped[str] = mapped_column(
        Text, nullable=False, server_default=text("'not_started'")
    )
    coaching_context: Mapped[dict] = mapped_column(
        JSONB,
        nullable=False,
        server_default=text("'{}'::jsonb"),
    )
    initial_assessment: Mapped[dict] = mapped_column(
        JSONB,
        nullable=False,
        server_default=text("'{}'::jsonb"),
    )
    athlete_state: Mapped[dict] = mapped_column(
        JSONB,
        nullable=False,
        server_default=text("'{}'::jsonb"),
    )
    safety_ack_version: Mapped[str | None] = mapped_column(Text, nullable=True)
    safety_acknowledged_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    stripe_customer_id: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
        unique=True,
    )
