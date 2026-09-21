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


def get_user_plan(db: Session, user_id: uuid.UUID) -> SubscriptionPlan:
    plan = db.scalar(
        select(SubscriptionPlan)
        .join(UserSubscription, UserSubscription.plan_id == SubscriptionPlan.id)
        .where(UserSubscription.user_id == user_id)
    )
    if plan is not None:
        return plan

    # The database trigger creates this membership for every new profile. This
    # fallback also gives pre-migration or partially provisioned users the same
    # central default without adding a profile-level plan flag.
    plan = db.scalar(
        select(SubscriptionPlan).where(SubscriptionPlan.code == PlanCode.FREE)
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
