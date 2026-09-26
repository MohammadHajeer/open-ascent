from __future__ import annotations

import hashlib
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

from app.models.enums import (
    EntitlementType,
    FeatureKey,
    FeatureUsageStatus,
    PlanCode,
    ResetPolicy,
)
from app.models.subscription import (
    FeatureUsage,
    PlanEntitlement,
    SubscriptionPlan,
    UserSubscription,
)
from app.services.entitlements import (
    UnconfiguredAllowanceError,
    get_user_entitlement,
    resolve_effective_plan,
)


class FeatureAccessDeniedError(RuntimeError):
    """Raised when the effective plan does not enable a feature."""


class QuotaExceededError(RuntimeError):
    """Raised when a metered feature has no remaining units in its window."""


class UsageIdempotencyConflictError(RuntimeError):
    """Raised when an operation key is reused for different logical work."""


class InvalidUsageTransitionError(RuntimeError):
    """Raised when a terminal usage record is asked to change state."""


class UsageRecordNotFoundError(LookupError):
    """Raised when a requested usage record does not exist for the user."""


def calendar_month_window(at: datetime) -> tuple[datetime, datetime]:
    """Return deterministic half-open UTC calendar-month boundaries."""
    if at.tzinfo is None:
        at = at.replace(tzinfo=UTC)
    at = at.astimezone(UTC)
    start = datetime(at.year, at.month, 1, tzinfo=UTC)
    if at.month == 12:
        end = datetime(at.year + 1, 1, 1, tzinfo=UTC)
    else:
        end = datetime(at.year, at.month + 1, 1, tzinfo=UTC)
    return start, end


def calendar_day_window(at: datetime) -> tuple[datetime, datetime]:
    """Return deterministic half-open UTC calendar-day boundaries."""
    if at.tzinfo is None:
        at = at.replace(tzinfo=UTC)
    at = at.astimezone(UTC)
    start = datetime(at.year, at.month, at.day, tzinfo=UTC)
    return start, start + timedelta(days=1)


RESET_WINDOWS = {
    ResetPolicy.CALENDAR_MONTH_UTC: calendar_month_window,
    ResetPolicy.CALENDAR_DAY_UTC: calendar_day_window,
}
RESET_PERIODS = {
    ResetPolicy.CALENDAR_MONTH_UTC: "month",
    ResetPolicy.CALENDAR_DAY_UTC: "day",
}


def usage_window(reset_policy: str | None, at: datetime) -> tuple[datetime, datetime]:
    try:
        return RESET_WINDOWS[ResetPolicy(reset_policy)](at)
    except (KeyError, ValueError) as exc:
        raise RuntimeError(f"Unsupported reset policy: {reset_policy!r}.") from exc


def _admitted_units(
    db: Session,
    *,
    user_id: uuid.UUID,
    feature_key: FeatureKey,
    window: tuple[datetime, datetime],
) -> int:
    return int(
        db.scalar(
            select(func.coalesce(func.sum(FeatureUsage.units), 0)).where(
                FeatureUsage.user_id == user_id,
                FeatureUsage.feature_key == feature_key.value,
                FeatureUsage.window_start == window[0],
                FeatureUsage.window_end == window[1],
                FeatureUsage.status.in_(
                    (
                        FeatureUsageStatus.RESERVED.value,
                        FeatureUsageStatus.CONSUMED.value,
                    )
                ),
            )
        )
        or 0
    )


@dataclass(frozen=True)
class UsageSummary:
    """Read-only view of one feature's allowance for display, never admission."""

    tier: PlanCode
    allowed: bool
    unlimited: bool
    limit: int | None
    used: int
    remaining: int | None
    period: str | None
    resets_at: datetime | None

    def as_dict(self) -> dict:
        return {
            "tier": self.tier.value,
            "allowed": self.allowed,
            "unlimited": self.unlimited,
            "limit": self.limit,
            "used": self.used,
            "remaining": self.remaining,
            "period": self.period,
            "resets_at": self.resets_at.isoformat() if self.resets_at else None,
        }


def usage_summary(
    db: Session,
    user_id: uuid.UUID,
    feature_key: FeatureKey,
    *,
    as_of: datetime | None = None,
) -> UsageSummary:
    evaluated_at = as_of or datetime.now(UTC)
    entitlement = get_user_entitlement(db, user_id, feature_key)
    tier = entitlement.plan_code if entitlement else resolve_effective_plan(db, user_id)
    if entitlement is None or not entitlement.enabled:
        return UsageSummary(tier, False, False, 0, 0, 0, None, None)
    if entitlement.entitlement_type is not EntitlementType.METERED:
        return UsageSummary(tier, True, True, None, 0, None, None, None)
    window = usage_window(entitlement.reset_policy, evaluated_at)
    used = _admitted_units(db, user_id=user_id, feature_key=feature_key, window=window)
    limit = entitlement.allowance_units
    remaining = None if limit is None else max(0, limit - used)
    return UsageSummary(
        tier,
        limit is not None and remaining > 0,
        False,
        limit,
        used,
        remaining,
        RESET_PERIODS[ResetPolicy(entitlement.reset_policy)],
        window[1],
    )


def _signed_int32(value: bytes) -> int:
    return int.from_bytes(value[:4], "big", signed=True)


def _lock_admission(db: Session, user_id: uuid.UUID, feature_key: FeatureKey) -> None:
    """Serialize one user's admissions for one feature until transaction end."""
    user_lock = _signed_int32(hashlib.sha256(user_id.bytes).digest())
    feature_lock = _signed_int32(hashlib.sha256(feature_key.value.encode()).digest())
    db.execute(
        text(
            "SELECT pg_advisory_xact_lock("
            "CAST(:user_lock AS integer), CAST(:feature_lock AS integer))"
        ),
        {"user_lock": user_lock, "feature_lock": feature_lock},
    )


def _get_existing_usage(
    db: Session,
    *,
    user_id: uuid.UUID,
    feature_key: FeatureKey,
    operation_key: str,
) -> FeatureUsage | None:
    return db.scalar(
        select(FeatureUsage)
        .where(
            FeatureUsage.user_id == user_id,
            FeatureUsage.feature_key == feature_key.value,
            FeatureUsage.operation_key == operation_key,
        )
        .with_for_update()
    )


def _validate_existing_usage(
    usage: FeatureUsage,
    *,
    request_fingerprint: str,
    units: int,
) -> None:
    if usage.request_fingerprint != request_fingerprint or usage.units != units:
        raise UsageIdempotencyConflictError(
            "The operation key was already used for different work."
        )


def reserve_usage(
    db: Session,
    *,
    user_id: uuid.UUID,
    feature_key: FeatureKey,
    operation_key: str,
    request_fingerprint: str,
    reservation_expires_at: datetime,
    units: int = 1,
    as_of: datetime | None = None,
) -> FeatureUsage | None:
    """Atomically admit metered work and return its ledger reservation.

    Boolean-enabled and unlimited entitlements are admitted without a metered
    ledger row. The caller owns the surrounding transaction and must commit the
    reservation together with the operation it admits.
    """
    if units <= 0:
        raise ValueError("Usage units must be positive.")
    if not operation_key:
        raise ValueError("An operation key is required.")
    if not request_fingerprint:
        raise ValueError("A request fingerprint is required.")

    evaluated_at = as_of or db.scalar(select(func.now()))
    if evaluated_at is None:
        raise RuntimeError("Could not determine database time.")
    if evaluated_at.tzinfo is None:
        evaluated_at = evaluated_at.replace(tzinfo=UTC)
    if reservation_expires_at.tzinfo is None:
        reservation_expires_at = reservation_expires_at.replace(tzinfo=UTC)
    if reservation_expires_at <= evaluated_at:
        raise ValueError("Reservation expiry must be in the future.")

    _lock_admission(db, user_id, feature_key)

    existing = _get_existing_usage(
        db,
        user_id=user_id,
        feature_key=feature_key,
        operation_key=operation_key,
    )
    if existing is not None:
        _validate_existing_usage(
            existing,
            request_fingerprint=request_fingerprint,
            units=units,
        )
        return existing

    # Keep the authoritative membership stable while resolving the effective
    # plan. Subscription writers naturally serialize on this same row lock.
    db.scalar(
        select(UserSubscription.id)
        .where(UserSubscription.user_id == user_id)
        .with_for_update()
    )
    plan_code = resolve_effective_plan(db, user_id, as_of=evaluated_at)
    plan = db.scalar(
        select(SubscriptionPlan).where(
            SubscriptionPlan.code == plan_code.value,
            SubscriptionPlan.is_active.is_(True),
        )
    )
    if plan is None and plan_code is not PlanCode.FREE:
        plan = db.scalar(
            select(SubscriptionPlan).where(
                SubscriptionPlan.code == PlanCode.FREE.value,
                SubscriptionPlan.is_active.is_(True),
            )
        )
    if plan is None:
        raise FeatureAccessDeniedError("No active effective plan is available.")

    entitlement = db.scalar(
        select(PlanEntitlement).where(
            PlanEntitlement.plan_id == plan.id,
            PlanEntitlement.feature_key == feature_key.value,
        )
    )
    if entitlement is None or not entitlement.enabled:
        raise FeatureAccessDeniedError(f"{feature_key.value} is not enabled.")

    entitlement_type = EntitlementType(entitlement.entitlement_type)
    if entitlement_type in {EntitlementType.BOOLEAN, EntitlementType.UNLIMITED}:
        return None
    if entitlement.allowance_units is None:
        raise UnconfiguredAllowanceError(
            f"No allowance has been configured for {feature_key.value}."
        )
    window_start, window_end = usage_window(entitlement.reset_policy, evaluated_at)
    admitted_units = _admitted_units(
        db, user_id=user_id, feature_key=feature_key, window=(window_start, window_end)
    )
    if admitted_units + units > entitlement.allowance_units:
        raise QuotaExceededError(f"{feature_key.value} allowance is exhausted.")

    usage = FeatureUsage(
        user_id=user_id,
        entitlement_id=entitlement.id,
        feature_key=feature_key.value,
        operation_key=operation_key,
        request_fingerprint=request_fingerprint,
        units=units,
        window_start=window_start,
        window_end=window_end,
        status=FeatureUsageStatus.RESERVED.value,
        reservation_expires_at=reservation_expires_at,
    )
    db.add(usage)
    db.flush()
    return usage


def _get_owned_usage(
    db: Session,
    usage_id: uuid.UUID,
    *,
    user_id: uuid.UUID | None,
) -> FeatureUsage:
    conditions = [FeatureUsage.id == usage_id]
    if user_id is not None:
        conditions.append(FeatureUsage.user_id == user_id)
    usage = db.scalar(select(FeatureUsage).where(*conditions).with_for_update())
    if usage is None:
        raise UsageRecordNotFoundError("Usage record not found.")
    return usage


def consume_usage(
    db: Session,
    usage_id: uuid.UUID,
    *,
    user_id: uuid.UUID | None = None,
    settled_at: datetime | None = None,
) -> FeatureUsage:
    usage = _get_owned_usage(db, usage_id, user_id=user_id)
    status = FeatureUsageStatus(usage.status)
    if status is FeatureUsageStatus.CONSUMED:
        return usage
    if status is FeatureUsageStatus.RELEASED:
        raise InvalidUsageTransitionError("Released usage cannot be consumed.")
    usage.status = FeatureUsageStatus.CONSUMED.value
    usage.settled_at = settled_at or db.scalar(select(func.now()))
    usage.release_reason = None
    db.flush()
    return usage


def release_usage(
    db: Session,
    usage_id: uuid.UUID,
    *,
    reason: str,
    user_id: uuid.UUID | None = None,
    settled_at: datetime | None = None,
) -> FeatureUsage:
    if not reason.strip():
        raise ValueError("A release reason is required.")
    usage = _get_owned_usage(db, usage_id, user_id=user_id)
    status = FeatureUsageStatus(usage.status)
    if status is FeatureUsageStatus.RELEASED:
        return usage
    if status is FeatureUsageStatus.CONSUMED:
        raise InvalidUsageTransitionError("Consumed usage cannot be released.")
    usage.status = FeatureUsageStatus.RELEASED.value
    usage.settled_at = settled_at or db.scalar(select(func.now()))
    usage.release_reason = reason.strip()
    db.flush()
    return usage


def reservation_expiry(*, minutes: int, now: datetime | None = None) -> datetime:
    """Build a timezone-aware expiry for callers without database time."""
    return (now or datetime.now(UTC)) + timedelta(minutes=minutes)
