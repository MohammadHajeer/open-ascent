"""Owner-scoped Stripe test billing reads and period-end cancellation."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Protocol

import stripe
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.models.profile import Profile
from app.models.subscription import SubscriptionPlan, UserSubscription
from app.services.entitlements import resolve_effective_plan
from app.services.stripe_webhooks import _object_id, _validated_period_and_price, _value


class BillingConfigurationError(RuntimeError):
    pass


class BillingProviderError(RuntimeError):
    pass


class BillingNotEligibleError(RuntimeError):
    pass


class StripeBillingGateway(Protocol):
    def retrieve_price(self, price_id: str): ...

    def retrieve_subscription(self, subscription_id: str): ...

    def schedule_cancellation(self, subscription_id: str): ...

    def resume_subscription(self, subscription_id: str): ...


class StripeTestBillingGateway:
    def __init__(self, secret_key: str) -> None:
        self.client = stripe.StripeClient(secret_key)

    def retrieve_price(self, price_id: str):
        return self.client.v1.prices.retrieve(price_id)

    def retrieve_subscription(self, subscription_id: str):
        return self.client.v1.subscriptions.retrieve(
            subscription_id, {"expand": ["items.data.price"]}
        )

    def schedule_cancellation(self, subscription_id: str):
        return self.client.v1.subscriptions.update(
            subscription_id, {"cancel_at_period_end": True},
            {"idempotency_key": f"open-ascent-cancel-period-end-{uuid.uuid4()}"},
        )

    def resume_subscription(self, subscription_id: str):
        return self.client.v1.subscriptions.update(
            subscription_id, {"cancel_at_period_end": False},
            {"idempotency_key": f"open-ascent-resume-{uuid.uuid4()}"},
        )


def _configured_price(db: Session, settings: Settings, gateway: StripeBillingGateway) -> dict:
    if settings.app_env == "production" or not settings.stripe_secret_key.startswith("sk_test_"):
        raise BillingConfigurationError("Stripe test billing is not configured.")
    plan = db.scalar(select(SubscriptionPlan).where(SubscriptionPlan.code == "pro"))
    if plan is None or not plan.is_active or plan.stripe_price_id != settings.stripe_pro_price_id:
        raise BillingConfigurationError("The configured Pro plan is unavailable.")
    try:
        price = gateway.retrieve_price(plan.stripe_price_id)
    except Exception as exc:
        raise BillingProviderError("Billing information is temporarily unavailable.") from exc
    recurring = _value(price, "recurring")
    amount = _value(price, "unit_amount")
    if (
        _value(price, "livemode") is not False
        or _value(price, "active") is not True
        or _value(price, "type") != "recurring"
        or _value(recurring, "interval") != "month"
        or _value(recurring, "interval_count") != 1
        or not isinstance(amount, int)
        or amount < 0
        or _value(price, "currency") != "usd"
    ):
        raise BillingConfigurationError("The configured Pro price is not an active monthly test price.")
    return {"unit_amount": amount, "currency": _value(price, "currency").upper(), "interval": "month"}


def configured_pro_price(db: Session, settings: Settings, gateway: StripeBillingGateway) -> dict:
    return _configured_price(db, settings, gateway)


def subscription_overview(
    db: Session, *, user_id: uuid.UUID, settings: Settings, gateway: StripeBillingGateway
) -> dict:
    price = _configured_price(db, settings, gateway)
    plan = resolve_effective_plan(db, user_id).value
    membership = db.scalar(select(UserSubscription).where(UserSubscription.user_id == user_id))
    current = membership if membership and membership.stripe_subscription_id else None
    end = current.current_period_end if current else None
    active = plan == "pro" and current is not None and current.provider_status == "active"
    return {
        "effective_plan": plan,
        "pro_price": price,
        "subscription_status": current.provider_status if current else None,
        "cancel_at_period_end": bool(active and current.cancel_at_period_end),
        "current_period_end": end if active else None,
        "can_cancel": bool(active and not current.cancel_at_period_end),
    }


def cancel_subscription_at_period_end(
    db: Session, *, user_id: uuid.UUID, settings: Settings, gateway: StripeBillingGateway
) -> None:
    _set_period_end_cancellation(
        db, user_id=user_id, settings=settings, gateway=gateway, scheduled=True
    )


def resume_subscription(
    db: Session, *, user_id: uuid.UUID, settings: Settings, gateway: StripeBillingGateway
) -> None:
    _set_period_end_cancellation(
        db, user_id=user_id, settings=settings, gateway=gateway, scheduled=False
    )


def _set_period_end_cancellation(
    db: Session, *, user_id: uuid.UUID, settings: Settings,
    gateway: StripeBillingGateway, scheduled: bool,
) -> None:
    _configured_price(db, settings, gateway)
    row = db.execute(
        select(UserSubscription, Profile.stripe_customer_id)
        .join(Profile, Profile.id == UserSubscription.user_id)
        .where(UserSubscription.user_id == user_id)
        .with_for_update()
    ).one_or_none()
    if row is None or not row[0].stripe_subscription_id or not row[1]:
        raise BillingNotEligibleError("There is no active Pro subscription to cancel.")
    membership, customer_id = row
    if resolve_effective_plan(db, user_id).value != "pro":
        raise BillingNotEligibleError("There is no active Pro subscription to cancel.")
    subscription_id = membership.stripe_subscription_id
    try:
        subscription = gateway.retrieve_subscription(subscription_id)
        if (
            _value(subscription, "livemode") is not False
            or _object_id(subscription) != subscription_id
            or _object_id(_value(subscription, "customer")) != customer_id
            or _value(subscription, "status") != "active"
        ):
            raise BillingNotEligibleError("There is no active Pro subscription to cancel.")
        period = _validated_period_and_price(
            subscription, expected_price_id=settings.stripe_pro_price_id
        )
        if not period or not all(period) or period[1] <= datetime.now(UTC):
            raise BillingNotEligibleError("The current billing period is unavailable.")
        if bool(_value(subscription, "cancel_at_period_end", False)) != scheduled:
            if scheduled:
                gateway.schedule_cancellation(subscription_id)
            else:
                gateway.resume_subscription(subscription_id)
            # Verify the resulting provider state; never infer it from the request.
            subscription = gateway.retrieve_subscription(subscription_id)
        if (
            _value(subscription, "livemode") is not False
            or _object_id(subscription) != subscription_id
            or _object_id(_value(subscription, "customer")) != customer_id
            or _value(subscription, "status") != "active"
            or _value(subscription, "cancel_at_period_end") is not scheduled
        ):
            raise BillingProviderError("Stripe did not confirm the subscription update.")
        period = _validated_period_and_price(
            subscription, expected_price_id=settings.stripe_pro_price_id
        )
        if not period or not all(period):
            raise BillingProviderError("Stripe did not confirm the billing period.")
    except (BillingNotEligibleError, BillingProviderError):
        raise
    except Exception as exc:
        raise BillingProviderError("Subscription management is temporarily unavailable.") from exc
    membership.provider_status = "active"
    membership.cancel_at_period_end = scheduled
    membership.current_period_start, membership.current_period_end = period
    membership.effective_start, membership.effective_end = period
    membership.last_verified_at = datetime.now(UTC)
    membership.sync_revision += 1
    db.commit()
