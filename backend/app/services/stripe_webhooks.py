from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, Protocol

import stripe
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.models.enums import PlanCode
from app.models.profile import Profile
from app.models.subscription import (
    StripeWebhookEvent,
    SubscriptionPlan,
    UserSubscription,
)

HANDLED_EVENT_TYPES = frozenset(
    {
        "checkout.session.completed",
        "customer.subscription.created",
        "customer.subscription.updated",
        "customer.subscription.deleted",
    }
)
PROVIDER_STATUSES = frozenset(
    {
        "active",
        "past_due",
        "incomplete",
        "incomplete_expired",
        "unpaid",
        "canceled",
        "paused",
        "trialing",
    }
)


class WebhookConfigurationError(RuntimeError):
    pass


class InvalidWebhookError(RuntimeError):
    pass


class LiveModeWebhookError(InvalidWebhookError):
    pass


class WebhookProviderError(RuntimeError):
    pass


class StripeSubscriptionGateway(Protocol):
    def retrieve_test_subscription(self, subscription_id: str): ...


class StripeTestSubscriptionGateway:
    def __init__(self, secret_key: str) -> None:
        self.client = stripe.StripeClient(secret_key)

    def retrieve_test_subscription(self, subscription_id: str):
        return self.client.v1.subscriptions.retrieve(
            subscription_id,
            {"expand": ["items.data.price"]},
        )


@dataclass(frozen=True)
class WebhookResult:
    outcome: str


def _value(value: Any, key: str, default: Any = None) -> Any:
    if isinstance(value, Mapping):
        return value.get(key, default)
    return getattr(value, key, default)


def _object_id(value: Any) -> str | None:
    if isinstance(value, str):
        return value
    candidate = _value(value, "id")
    return candidate if isinstance(candidate, str) and candidate else None


def _unix_datetime(value: Any) -> datetime | None:
    if not isinstance(value, (int, float)) or isinstance(value, bool):
        return None
    try:
        return datetime.fromtimestamp(value, UTC)
    except (OSError, OverflowError, ValueError):
        return None


def _as_utc(value: datetime) -> datetime:
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)


def validate_test_webhook_config(settings: Settings) -> str:
    if settings.app_env == "production":
        raise WebhookConfigurationError("Test webhooks are disabled in production.")
    if not settings.stripe_secret_key.startswith("sk_test_"):
        raise WebhookConfigurationError("A Stripe test secret key is required.")
    if not settings.stripe_webhook_secret or not settings.stripe_webhook_secret.startswith(
        "whsec_"
    ):
        raise WebhookConfigurationError("A Stripe test webhook secret is required.")
    if not settings.stripe_pro_price_id.startswith("price_"):
        raise WebhookConfigurationError("A Stripe test Pro price is required.")
    return settings.stripe_webhook_secret


def construct_verified_test_event(
    payload: bytes,
    signature: str,
    *,
    settings: Settings,
):
    secret = validate_test_webhook_config(settings)
    try:
        event = stripe.Webhook.construct_event(payload, signature, secret)
    except (ValueError, stripe.error.SignatureVerificationError) as exc:
        raise InvalidWebhookError("Invalid Stripe webhook.") from exc

    event_id = _value(event, "id")
    event_type = _value(event, "type")
    event_created = _value(event, "created")
    data_object = _value(_value(event, "data"), "object")
    if (
        not isinstance(event_id, str)
        or not event_id
        or not isinstance(event_type, str)
        or not event_type
        or _unix_datetime(event_created) is None
        or data_object is None
    ):
        raise InvalidWebhookError("Malformed Stripe webhook.")
    if _value(event, "livemode") is not False:
        raise LiveModeWebhookError("Live-mode Stripe webhooks are not accepted.")
    return event


def _event_details(event: Any) -> tuple[str, str, datetime, Any]:
    event_id = _value(event, "id")
    event_type = _value(event, "type")
    event_created_at = _unix_datetime(_value(event, "created"))
    data_object = _value(_value(event, "data"), "object")
    if not isinstance(event_id, str) or not isinstance(event_type, str):
        raise InvalidWebhookError("Malformed Stripe webhook.")
    if event_created_at is None or data_object is None:
        raise InvalidWebhookError("Malformed Stripe webhook.")
    return event_id, event_type, event_created_at, data_object


def _reserve_event(
    db: Session,
    *,
    event_id: str,
    event_type: str,
    event_created_at: datetime,
    data_object: Any,
    received_at: datetime,
) -> StripeWebhookEvent | None:
    if db.get(StripeWebhookEvent, event_id) is not None:
        return None
    record = StripeWebhookEvent(
        id=event_id,
        event_type=event_type,
        stripe_object_id=_object_id(data_object),
        event_created_at=event_created_at,
        processed_at=received_at,
        outcome="processing",
    )
    db.add(record)
    # The primary key makes concurrent deliveries serialize here. If another
    # transaction wins the race, the caller treats the uniqueness failure as a
    # duplicate after rolling back.
    db.flush()
    return record


def _map_checkout_session(
    db: Session, checkout: Any
) -> tuple[UserSubscription, str, str] | None:
    if (
        _value(checkout, "livemode") is not False
        or _value(checkout, "mode") != "subscription"
        or _value(checkout, "status") != "complete"
    ):
        if _value(checkout, "livemode") is True:
            raise LiveModeWebhookError("Live-mode Stripe objects are not accepted.")
        return None
    session_id = _object_id(checkout)
    customer_id = _object_id(_value(checkout, "customer"))
    subscription_id = _object_id(_value(checkout, "subscription"))
    if not session_id or not customer_id or not subscription_id:
        return None
    row = db.execute(
        select(UserSubscription, Profile.stripe_customer_id)
        .join(Profile, Profile.id == UserSubscription.user_id)
        .where(UserSubscription.checkout_session_id == session_id)
        .with_for_update()
    ).one_or_none()
    if row is None or row[1] != customer_id:
        return None
    return row[0], customer_id, subscription_id


def _map_subscription(
    db: Session, subscription: Any
) -> tuple[UserSubscription, str, str] | None:
    if _value(subscription, "livemode") is not False:
        if _value(subscription, "livemode") is True:
            raise LiveModeWebhookError("Live-mode Stripe objects are not accepted.")
        return None
    subscription_id = _object_id(subscription)
    customer_id = _object_id(_value(subscription, "customer"))
    if not subscription_id or not customer_id:
        return None
    rows = list(
        db.execute(
            select(UserSubscription, Profile.stripe_customer_id)
            .join(Profile, Profile.id == UserSubscription.user_id)
            .where(
                or_(
                    UserSubscription.stripe_subscription_id == subscription_id,
                    Profile.stripe_customer_id == customer_id,
                )
            )
            .with_for_update()
        ).all()
    )
    if len(rows) != 1 or rows[0][1] != customer_id:
        return None
    return rows[0][0], customer_id, subscription_id


def _validated_period_and_price(
    subscription: Any,
    *,
    expected_price_id: str,
) -> tuple[datetime | None, datetime | None] | None:
    items = _value(_value(subscription, "items"), "data")
    if not isinstance(items, (list, tuple)) or len(items) != 1:
        return None
    item = items[0]
    price = _value(item, "price")
    if (
        _object_id(price) != expected_price_id
        or _value(price, "livemode") is not False
        or _value(price, "type") != "recurring"
        or _value(_value(price, "recurring"), "interval") != "month"
        or _value(_value(price, "recurring"), "interval_count", 1) != 1
    ):
        if _value(price, "livemode") is True:
            raise LiveModeWebhookError("Live-mode Stripe objects are not accepted.")
        return None

    period_start = _unix_datetime(
        _value(item, "current_period_start", _value(subscription, "current_period_start"))
    )
    period_end = _unix_datetime(
        _value(item, "current_period_end", _value(subscription, "current_period_end"))
    )
    if period_start is None or period_end is None or period_end <= period_start:
        return (None, None)
    return period_start, period_end


def reconcile_verified_event(
    db: Session,
    event: Any,
    *,
    settings: Settings,
    gateway: StripeSubscriptionGateway,
    received_at: datetime | None = None,
) -> WebhookResult:
    """Reconcile one signature-verified event in the caller's transaction."""
    event_id, event_type, event_created_at, data_object = _event_details(event)
    now = received_at or datetime.now(UTC)
    record = _reserve_event(
        db,
        event_id=event_id,
        event_type=event_type,
        event_created_at=event_created_at,
        data_object=data_object,
        received_at=now,
    )
    if record is None:
        return WebhookResult(outcome="duplicate")

    if event_type not in HANDLED_EVENT_TYPES:
        record.outcome = "ignored_unhandled"
        return WebhookResult(outcome=record.outcome)

    mapped = (
        _map_checkout_session(db, data_object)
        if event_type == "checkout.session.completed"
        else _map_subscription(db, data_object)
    )
    if mapped is None:
        record.outcome = "ignored_unmapped"
        return WebhookResult(outcome=record.outcome)
    membership, customer_id, subscription_id = mapped

    if (
        membership.provider_event_created_at is not None
        and event_created_at < _as_utc(membership.provider_event_created_at)
    ):
        record.outcome = "ignored_stale"
        return WebhookResult(outcome=record.outcome)

    try:
        subscription = gateway.retrieve_test_subscription(subscription_id)
    except LiveModeWebhookError:
        raise
    except Exception as exc:
        raise WebhookProviderError("Unable to verify Stripe subscription state.") from exc

    if _value(subscription, "livemode") is not False:
        if _value(subscription, "livemode") is True:
            raise LiveModeWebhookError("Live-mode Stripe objects are not accepted.")
        record.outcome = "ignored_invalid"
        return WebhookResult(outcome=record.outcome)
    if (
        _object_id(subscription) != subscription_id
        or _object_id(_value(subscription, "customer")) != customer_id
    ):
        record.outcome = "ignored_invalid"
        return WebhookResult(outcome=record.outcome)

    pro_plan = db.scalar(
        select(SubscriptionPlan).where(
            SubscriptionPlan.code == PlanCode.PRO.value,
            SubscriptionPlan.is_active.is_(True),
            SubscriptionPlan.stripe_price_id == settings.stripe_pro_price_id,
        )
    )
    if pro_plan is None:
        raise WebhookConfigurationError("The configured Pro plan is unavailable.")
    period = _validated_period_and_price(
        subscription, expected_price_id=pro_plan.stripe_price_id
    )
    status = _value(subscription, "status")
    if period is None or status not in PROVIDER_STATUSES:
        record.outcome = "ignored_invalid"
        return WebhookResult(outcome=record.outcome)

    period_start, period_end = period
    membership.plan_id = pro_plan.id
    membership.provider_status = status
    membership.stripe_subscription_id = subscription_id
    membership.current_period_start = period_start
    membership.current_period_end = period_end
    membership.effective_start = period_start
    membership.effective_end = period_end
    membership.cancel_at_period_end = bool(
        _value(subscription, "cancel_at_period_end", False)
    )
    membership.last_verified_at = now
    membership.sync_revision += 1
    membership.last_event_id = event_id
    membership.last_event_received_at = now
    membership.provider_event_created_at = event_created_at
    record.outcome = "applied"
    return WebhookResult(outcome=record.outcome)
