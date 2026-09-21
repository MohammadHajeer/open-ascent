from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.models.mixins import TimestampMixin


class SubscriptionPlan(TimestampMixin, Base):
    __tablename__ = "subscription_plans"
    __table_args__ = (
        CheckConstraint("code IN ('free', 'pro')", name="ck_subscription_plans_code"),
        CheckConstraint(
            """
            stripe_price_id IS NULL OR code = 'pro'
            """,
            name="ck_subscription_plans_price_mapping",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    code: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    is_active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("true")
    )
    stripe_price_id: Mapped[str | None] = mapped_column(
        Text, nullable=True, unique=True
    )


class PlanEntitlement(TimestampMixin, Base):
    __tablename__ = "plan_entitlements"
    __table_args__ = (
        UniqueConstraint(
            "plan_id",
            "feature_key",
            name="uq_plan_entitlements_plan_feature",
        ),
        CheckConstraint(
            "feature_key IN ("
            "'video_analysis', 'training_plan_generation', 'ai_coach_reply', "
            "'live_coach', 'adaptive_training_plans', "
            "'advanced_progress_insights'"
            ")",
            name="ck_plan_entitlements_feature_key",
        ),
        CheckConstraint(
            "entitlement_type IN ('boolean', 'metered', 'unlimited')",
            name="ck_plan_entitlements_type",
        ),
        CheckConstraint(
            """
            (entitlement_type = 'boolean'
                AND allowance_units IS NULL
                AND reset_policy IS NULL)
            OR
            (entitlement_type = 'metered'
                AND enabled
                AND (allowance_units IS NULL OR allowance_units >= 0)
                AND reset_policy = 'calendar_month_utc')
            OR
            (entitlement_type = 'unlimited'
                AND enabled
                AND allowance_units IS NULL
                AND reset_policy IS NULL)
            """,
            name="ck_plan_entitlements_configuration",
        ),
        CheckConstraint("revision > 0", name="ck_plan_entitlements_revision"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    plan_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("subscription_plans.id", ondelete="RESTRICT"),
        nullable=False,
    )
    feature_key: Mapped[str] = mapped_column(Text, nullable=False)
    entitlement_type: Mapped[str] = mapped_column(Text, nullable=False)
    enabled: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("true")
    )
    allowance_units: Mapped[int | None] = mapped_column(Integer, nullable=True)
    reset_policy: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
    )
    revision: Mapped[int] = mapped_column(Integer, nullable=False)
    effective_from: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
    )


class UserSubscription(TimestampMixin, Base):
    __tablename__ = "user_subscriptions"
    __table_args__ = (
        CheckConstraint(
            "provider_status IS NULL OR provider_status IN ('active','past_due','incomplete','incomplete_expired','unpaid','canceled','paused','trialing')",
            name="ck_user_subscriptions_provider_status",
        ),
        CheckConstraint(
            """
            (effective_start IS NULL AND effective_end IS NULL)
            OR (effective_start IS NOT NULL AND effective_end IS NOT NULL AND effective_end > effective_start)
            """,
            name="ck_user_subscriptions_effective_bounds",
        ),
        CheckConstraint(
            """
            (current_period_start IS NULL AND current_period_end IS NULL)
            OR (current_period_start IS NOT NULL AND current_period_end IS NOT NULL AND current_period_end > current_period_start)
            """,
            name="ck_user_subscriptions_period_bounds",
        ),
        CheckConstraint(
            "sync_revision > 0", name="ck_user_subscriptions_sync_revision"
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
        unique=True,
    )
    plan_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("subscription_plans.id", ondelete="RESTRICT"),
        nullable=False,
    )
    provider_status: Mapped[str | None] = mapped_column(Text, nullable=True)
    effective_start: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    effective_end: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    current_period_start: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    current_period_end: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    cancel_at_period_end: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("false")
    )
    stripe_subscription_id: Mapped[str | None] = mapped_column(
        Text, nullable=True, unique=True
    )
    last_verified_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    sync_revision: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=text("1")
    )
    checkout_operation_key: Mapped[str | None] = mapped_column(
        Text, nullable=True, unique=True
    )
    checkout_session_id: Mapped[str | None] = mapped_column(
        Text, nullable=True, unique=True
    )
    checkout_expires_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    last_event_id: Mapped[str | None] = mapped_column(Text, nullable=True)
    last_event_received_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )


class FeatureUsage(TimestampMixin, Base):
    __tablename__ = "feature_usage"
    __table_args__ = (
        UniqueConstraint(
            "user_id",
            "feature_key",
            "operation_key",
            name="uq_feature_usage_user_feature_operation",
        ),
        CheckConstraint(
            "feature_key IN ('video_analysis', 'training_plan_generation', 'ai_coach_reply')",
            name="ck_feature_usage_feature_key",
        ),
        CheckConstraint("units > 0", name="ck_feature_usage_units"),
        CheckConstraint(
            "status IN ('reserved', 'consumed', 'released')",
            name="ck_feature_usage_status",
        ),
        CheckConstraint(
            "window_end > window_start", name="ck_feature_usage_window_bounds"
        ),
        CheckConstraint(
            """
            (status = 'reserved' AND settled_at IS NULL)
            OR (status IN ('consumed', 'released') AND settled_at IS NOT NULL)
            """,
            name="ck_feature_usage_settlement",
        ),
        Index(
            "ix_feature_usage_quota_lookup",
            "user_id",
            "feature_key",
            "window_start",
            "status",
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
    entitlement_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("plan_entitlements.id", ondelete="RESTRICT"),
        nullable=False,
    )
    feature_key: Mapped[str] = mapped_column(Text, nullable=False)
    operation_key: Mapped[str] = mapped_column(Text, nullable=False)
    request_fingerprint: Mapped[str] = mapped_column(Text, nullable=False)
    units: Mapped[int] = mapped_column(Integer, nullable=False)
    window_start: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
    )
    window_end: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
    )
    status: Mapped[str] = mapped_column(
        Text, nullable=False, server_default=text("'reserved'")
    )
    reservation_expires_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
    )
    settled_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    release_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
