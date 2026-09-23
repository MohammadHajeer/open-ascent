from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.enums import EntitlementType, FeatureKey, PlanCode
from app.models.subscription import PlanEntitlement, SubscriptionPlan, UserSubscription
from app.subscriptions.catalog import PLAN_CATALOG


@dataclass(frozen=True)
class ResolvedEntitlement:
    plan_code: PlanCode
    feature_key: FeatureKey
    entitlement_type: EntitlementType
    enabled: bool
    allowance_units: int | None
    reset_policy: str | None

    @property
    def is_unlimited(self) -> bool:
        return self.entitlement_type is EntitlementType.UNLIMITED

    @property
    def is_limit_configured(self) -> bool:
        return (
            self.entitlement_type is not EntitlementType.METERED
            or self.allowance_units is not None
        )


class UnconfiguredAllowanceError(RuntimeError):
    """Raised when product has not selected a quota for a metered feature."""


def seed_plan_catalog(
    db: Session,
    *,
    pro_stripe_price_id: str | None = None,
    effective_from: datetime | None = None,
) -> None:
    """Idempotently synchronize the database with the central plan catalog."""
    changed_at = effective_from or datetime.now(UTC)

    for definition in PLAN_CATALOG:
        plan = db.scalar(
            select(SubscriptionPlan).where(SubscriptionPlan.code == definition.code)
        )
        stripe_price_id = (
            (pro_stripe_price_id or None) if definition.code is PlanCode.PRO else None
        )
        if plan is None:
            plan = SubscriptionPlan(
                code=definition.code,
                name=definition.name,
                is_active=True,
                stripe_price_id=stripe_price_id,
            )
            db.add(plan)
            db.flush()
        else:
            plan.name = definition.name
            plan.is_active = True
            if definition.code is PlanCode.PRO and stripe_price_id is not None:
                plan.stripe_price_id = stripe_price_id

        for configured in definition.entitlements:
            entitlement = db.scalar(
                select(PlanEntitlement).where(
                    PlanEntitlement.plan_id == plan.id,
                    PlanEntitlement.feature_key == configured.feature_key,
                )
            )
            values = {
                "entitlement_type": configured.entitlement_type.value,
                "enabled": configured.enabled,
                "allowance_units": (
                    entitlement.allowance_units
                    if entitlement is not None
                    and configured.entitlement_type is EntitlementType.METERED
                    and configured.allowance_units is None
                    else configured.allowance_units
                ),
                "reset_policy": (
                    configured.reset_policy.value if configured.reset_policy else None
                ),
            }
            if entitlement is None:
                db.add(
                    PlanEntitlement(
                        plan_id=plan.id,
                        feature_key=configured.feature_key.value,
                        revision=1,
                        effective_from=changed_at,
                        **values,
                    )
                )
                continue

            if any(getattr(entitlement, key) != value for key, value in values.items()):
                for key, value in values.items():
                    setattr(entitlement, key, value)
                entitlement.revision += 1
                entitlement.effective_from = changed_at

    db.flush()


def resolve_effective_plan(
    db: Session,
    user_id: uuid.UUID,
    *,
    as_of: datetime | None = None,
) -> PlanCode:
    """Resolve the current effective plan from authoritative subscription state.

    A Pro subscription is effective only when the provider has verified an
    active subscription and both validity windows contain ``as_of``. Every
    other state, including malformed or partially provisioned rows, fails
    closed to Free. JWT claims are intentionally not consulted here.
    """
    evaluated_at = as_of or datetime.now(UTC)
    if evaluated_at.tzinfo is None:
        evaluated_at = evaluated_at.replace(tzinfo=UTC)
    pro = db.scalar(_effective_pro_users_query([user_id], evaluated_at))
    return PlanCode.PRO if pro == user_id else PlanCode.FREE


def _effective_pro_users_query(
    user_ids: list[uuid.UUID] | None, evaluated_at: datetime
):
    """Shared provider-backed tier predicate for one or many users."""
    query = (
        select(UserSubscription.user_id)
        .select_from(SubscriptionPlan)
        .join(UserSubscription, UserSubscription.plan_id == SubscriptionPlan.id)
        .where(
            SubscriptionPlan.code == PlanCode.PRO.value,
            SubscriptionPlan.is_active.is_(True),
            SubscriptionPlan.stripe_price_id.is_not(None),
            UserSubscription.provider_status == "active",
            UserSubscription.stripe_subscription_id.like(r"sub\_%", escape="\\"),
            UserSubscription.last_verified_at.is_not(None),
            UserSubscription.last_verified_at <= evaluated_at,
            UserSubscription.effective_start.is_not(None),
            UserSubscription.effective_end.is_not(None),
            UserSubscription.effective_start <= evaluated_at,
            evaluated_at < UserSubscription.effective_end,
            UserSubscription.current_period_start.is_not(None),
            UserSubscription.current_period_end.is_not(None),
            UserSubscription.current_period_start <= evaluated_at,
            evaluated_at < UserSubscription.current_period_end,
        )
    )
    return (
        query.where(UserSubscription.user_id.in_(user_ids))
        if user_ids is not None
        else query
    )


def effective_pro_user_ids(
    db: Session, user_ids: list[uuid.UUID], *, as_of: datetime | None = None
) -> set[uuid.UUID]:
    if not user_ids:
        return set()
    evaluated_at = as_of or datetime.now(UTC)
    if evaluated_at.tzinfo is None:
        evaluated_at = evaluated_at.replace(tzinfo=UTC)
    return set(db.scalars(_effective_pro_users_query(user_ids, evaluated_at)))


def get_user_plan(db: Session, user_id: uuid.UUID) -> SubscriptionPlan:
    plan_code = resolve_effective_plan(db, user_id)
    plan = db.scalar(
        select(SubscriptionPlan).where(SubscriptionPlan.code == plan_code.value)
    )
    if plan is not None:
        return plan

    # The database trigger creates this membership for every new profile. This
    # fallback gives pre-migration users the same central default without
    # adding a profile-level plan flag. A missing Free seed is a deployment
    # error rather than a reason to grant Pro.
    plan = db.scalar(
        select(SubscriptionPlan).where(SubscriptionPlan.code == PlanCode.FREE.value)
    )
    if plan is None:
        raise LookupError("The Free subscription plan has not been seeded.")
    return plan


def get_user_entitlement(
    db: Session,
    user_id: uuid.UUID,
    feature_key: FeatureKey,
) -> ResolvedEntitlement | None:
    plan = get_user_plan(db, user_id)
    entitlement = db.scalar(
        select(PlanEntitlement).where(
            PlanEntitlement.plan_id == plan.id,
            PlanEntitlement.feature_key == feature_key,
        )
    )
    if entitlement is None:
        return None
    return ResolvedEntitlement(
        plan_code=PlanCode(plan.code),
        feature_key=FeatureKey(entitlement.feature_key),
        entitlement_type=EntitlementType(entitlement.entitlement_type),
        enabled=entitlement.enabled,
        allowance_units=entitlement.allowance_units,
        reset_policy=entitlement.reset_policy,
    )


def is_feature_enabled(
    db: Session,
    user_id: uuid.UUID,
    feature_key: FeatureKey,
) -> bool:
    entitlement = get_user_entitlement(db, user_id, feature_key)
    return entitlement is not None and entitlement.enabled


def get_feature_allowance(
    db: Session,
    user_id: uuid.UUID,
    feature_key: FeatureKey,
) -> int | None:
    """Return a configured quota, or None only for explicit unlimited access."""
    entitlement = get_user_entitlement(db, user_id, feature_key)
    if entitlement is None or not entitlement.enabled:
        return 0
    if entitlement.entitlement_type is EntitlementType.BOOLEAN:
        raise TypeError(f"{feature_key.value} is a boolean entitlement.")
    if entitlement.entitlement_type is EntitlementType.UNLIMITED:
        return None
    if entitlement.allowance_units is None:
        raise UnconfiguredAllowanceError(
            f"No allowance has been configured for {feature_key.value}."
        )
    return entitlement.allowance_units
