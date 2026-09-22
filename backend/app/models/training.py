from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.models.mixins import TimestampMixin


class TrainingPlan(TimestampMixin, Base):
    __tablename__ = "training_plans"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("profiles.id", ondelete="CASCADE"),
        nullable=False,
    )
    title: Mapped[str] = mapped_column(Text, nullable=False)
    saved_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("now()"),
    )
    plan_document: Mapped[dict] = mapped_column(JSONB, nullable=False)


class WorkoutSession(TimestampMixin, Base):
    __tablename__ = "workout_sessions"
    __table_args__ = (
        CheckConstraint(
            "source IN ('manual', 'self_reported', 'uploaded_analysis', 'live_coach')",
            name="ck_workout_sessions_source",
        ),
        CheckConstraint(
            "completed_at IS NULL OR completed_at >= started_at",
            name="ck_workout_sessions_time_order",
        ),
        Index(
            "uq_workout_sessions_one_active_per_user",
            "user_id",
            unique=True,
            postgresql_where=text("completed_at IS NULL"),
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("profiles.id", ondelete="CASCADE"),
        nullable=False,
    )
    training_plan_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("training_plans.id", ondelete="RESTRICT"),
        nullable=True,
    )
    source: Mapped[str] = mapped_column(Text, nullable=False)
    started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("now()"),
    )
    completed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    summary: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)


class WorkoutSet(TimestampMixin, Base):
    __tablename__ = "workout_sets"
    __table_args__ = (
        UniqueConstraint(
            "session_id", "position", name="uq_workout_sets_session_position"
        ),
        CheckConstraint(
            "source IN ('manual', 'self_reported', 'uploaded_analysis', 'live_coach')",
            name="ck_workout_sets_source",
        ),
        CheckConstraint("position >= 0", name="ck_workout_sets_position"),
        CheckConstraint(
            """
            (reps IS NOT NULL AND reps > 0 AND hold_seconds IS NULL)
            OR (reps IS NULL AND hold_seconds IS NOT NULL AND hold_seconds > 0)
            """,
            name="ck_workout_sets_primary_value",
        ),
        CheckConstraint(
            """
            analysis_segment_key IS NULL OR analysis_id IS NOT NULL
            """,
            name="ck_workout_sets_analysis_segment_pair",
        ),
        CheckConstraint(
            "performer IN ('self', 'other', 'unknown')",
            name="ck_workout_sets_performer",
        ),
        CheckConstraint(
            "intent IN ('training_set', 'assessment', 'max_test', 'skill_attempt')",
            name="ck_workout_sets_intent",
        ),
        CheckConstraint(
            "(source = 'uploaded_analysis' AND analysis_id IS NOT NULL) "
            "OR (source <> 'uploaded_analysis' AND analysis_id IS NULL)",
            name="ck_workout_sets_analysis_source",
        ),
        CheckConstraint(
            "live_coach_session_ref IS NULL OR source = 'live_coach'",
            name="ck_workout_sets_live_coach_source",
        ),
        Index(
            "uq_workout_sets_analysis_segment",
            "analysis_id",
            "analysis_segment_key",
            unique=True,
            postgresql_where=text("analysis_id IS NOT NULL AND analysis_segment_key IS NOT NULL"),
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    session_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("workout_sessions.id", ondelete="CASCADE"),
        nullable=False,
    )
    movement_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("movements.id", ondelete="RESTRICT"),
        nullable=False,
    )
    analysis_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("analyses.id", ondelete="RESTRICT"),
        nullable=True,
    )
    position: Mapped[int] = mapped_column(Integer, nullable=False)
    source: Mapped[str] = mapped_column(Text, nullable=False)
    performer: Mapped[str] = mapped_column(Text, nullable=False)
    intent: Mapped[str] = mapped_column(Text, nullable=False)
    reps: Mapped[int | None] = mapped_column(Integer, nullable=True)
    hold_seconds: Mapped[Decimal | None] = mapped_column(
        Numeric(10, 3),
        nullable=True,
    )
    analysis_segment_key: Mapped[str | None] = mapped_column(Text, nullable=True)
    live_coach_session_ref: Mapped[str | None] = mapped_column(Text, nullable=True)
