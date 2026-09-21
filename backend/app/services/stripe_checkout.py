from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Protocol
from urllib.parse import urlsplit, urlunsplit

import stripe
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.models.enums import PlanCode
from app.models.profile import Profile
from app.models.subscription import SubscriptionPlan, UserSubscription
from app.services.entitlements import resolve_effective_plan


class CheckoutConfigurationError(RuntimeError):
    pass


class CheckoutNotEligibleError(RuntimeError):
    pass


class CheckoutProviderError(RuntimeError):
    pass


@dataclass(frozen=True)
class CheckoutResult:
    url: str


class StripeGateway(Protocol):
    def validate_monthly_test_price(self, price_id: str) -> None: ...

    def get_test_customer(self, customer_id: str): ...

    def create_test_customer(self, user_id: uuid.UUID, display_name: str): ...

    def get_open_checkout(self, session_id: str): ...

    def create_subscription_checkout(
        self,
        *,
        user_id: uuid.UUID,
        customer_id: str,
        price_id: str,
        success_url: str,
        cancel_url: str,
        operation_key: str,
    ): ...


class StripeTestGateway:
    def __init__(self, secret_key: str) -> None:
        self.client = stripe.StripeClient(secret_key)

    def validate_monthly_test_price(self, price_id: str) -> None:
        price = self.client.v1.prices.retrieve(price_id)
        recurring = getattr(price, "recurring", None)
        if (
            getattr(price, "livemode", True)
            or not getattr(price, "active", False)
            or getattr(price, "type", None) != "recurring"
            or recurring is None
            or getattr(recurring, "interval", None) != "month"
        ):
            raise CheckoutConfigurationError(
                "The configured Pro price is not an active monthly test price."
            )

    def get_test_customer(self, customer_id: str):
        customer = self.client.v1.customers.retrieve(customer_id)
        if getattr(customer, "deleted", False):
            return None
        if getattr(customer, "livemode", True):
            raise CheckoutConfigurationError(
                "The stored Stripe customer is not a test customer."
            )
        return customer

    def create_test_customer(self, user_id: uuid.UUID, display_name: str):
        customer = self.client.v1.customers.create(
            {
                "name": display_name,
                "metadata": {"open_ascent_user_id": str(user_id)},
            },
            {"idempotency_key": f"open-ascent-test-customer-{user_id}"},
        )
        if getattr(customer, "livemode", True):
            raise CheckoutConfigurationError(
                "Stripe returned a non-test customer for test Checkout."
            )
        return customer

    def get_open_checkout(self, session_id: str):
        checkout = self.client.v1.checkout.sessions.retrieve(session_id)
        if (
            getattr(checkout, "livemode", True)
            or getattr(checkout, "status", None) != "open"
            or not getattr(checkout, "url", None)
        ):
            return None
        return checkout

    def create_subscription_checkout(
        self,
        *,
        user_id: uuid.UUID,
        customer_id: str,
        price_id: str,
        success_url: str,
        cancel_url: str,
        operation_key: str,
    ):
        checkout = self.client.v1.checkout.sessions.create(
            {
                "mode": "subscription",
                "customer": customer_id,
                "client_reference_id": str(user_id),
                "line_items": [{"price": price_id, "quantity": 1}],
                "success_url": success_url,
                "cancel_url": cancel_url,
                "metadata": {"open_ascent_user_id": str(user_id)},
                "subscription_data": {
                    "metadata": {"open_ascent_user_id": str(user_id)}
                },
            },
            {"idempotency_key": operation_key},
        )
        if getattr(checkout, "livemode", True) or not getattr(checkout, "url", None):
            raise CheckoutProviderError("Stripe did not return a test Checkout URL.")
        return checkout


def validate_test_checkout_config(settings: Settings, price_id: str | None) -> str:
    if settings.app_env == "production":
        raise CheckoutConfigurationError(
            "Test Checkout is disabled in the production environment."
        )
    if not settings.stripe_secret_key.startswith("sk_test_"):
        raise CheckoutConfigurationError("A Stripe test secret key is required.")
    if not price_id or not price_id.startswith("price_"):
        raise CheckoutConfigurationError("A Stripe test Pro price is required.")
    if settings.stripe_pro_price_id != price_id:
        raise CheckoutConfigurationError(
            "The seeded Pro price does not match server configuration."
        )
    return price_id


def _trusted_checkout_url(frontend_url: str, query_value: str) -> str:
    parsed = urlsplit(frontend_url)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise CheckoutConfigurationError("The configured frontend URL is invalid.")
    return urlunsplit(
        (parsed.scheme, parsed.netloc, "/dashboard/settings", f"checkout={query_value}", "")
    )


def _as_utc(value: datetime) -> datetime:
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)


def create_pro_test_checkout(
    db: Session,
    *,
    user_id: uuid.UUID,
    settings: Settings,
    gateway: StripeGateway,
) -> CheckoutResult:
    if resolve_effective_plan(db, user_id) is PlanCode.PRO:
        raise CheckoutNotEligibleError("Your account already has Pro access.")

    pro_plan = db.scalar(
        select(SubscriptionPlan).where(
            SubscriptionPlan.code == PlanCode.PRO.value,
            SubscriptionPlan.is_active.is_(True),
        )
    )
    if pro_plan is None:
        raise CheckoutConfigurationError("The Pro plan is not available.")
    price_id = validate_test_checkout_config(settings, pro_plan.stripe_price_id)

    try:
        gateway.validate_monthly_test_price(price_id)
    except CheckoutConfigurationError:
        raise
    except Exception as exc:
        raise CheckoutProviderError("Checkout is temporarily unavailable.") from exc

    profile = db.scalar(select(Profile).where(Profile.id == user_id).with_for_update())
    membership = db.scalar(
        select(UserSubscription)
        .where(UserSubscription.user_id == user_id)
        .with_for_update()
    )
    if profile is None or membership is None:
        raise CheckoutConfigurationError("The account subscription record is missing.")

    now = datetime.now(UTC)
    if (
        membership.checkout_session_id
        and membership.checkout_expires_at
        and _as_utc(membership.checkout_expires_at) > now
    ):
        try:
            existing = gateway.get_open_checkout(membership.checkout_session_id)
        except Exception as exc:
            raise CheckoutProviderError("Checkout is temporarily unavailable.") from exc
        if existing is not None:
            return CheckoutResult(url=existing.url)

    try:
        customer = (
            gateway.get_test_customer(profile.stripe_customer_id)
            if profile.stripe_customer_id
            else None
        )
        if customer is None:
            customer = gateway.create_test_customer(user_id, profile.display_name)
            profile.stripe_customer_id = customer.id

        operation_key = str(uuid.uuid4())
        checkout = gateway.create_subscription_checkout(
            user_id=user_id,
            customer_id=customer.id,
            price_id=price_id,
            success_url=_trusted_checkout_url(settings.frontend_url, "success"),
            cancel_url=_trusted_checkout_url(settings.frontend_url, "cancelled"),
            operation_key=operation_key,
        )
    except (CheckoutConfigurationError, CheckoutProviderError):
        db.rollback()
        raise
    except Exception as exc:
        db.rollback()
        raise CheckoutProviderError("Checkout is temporarily unavailable.") from exc

    membership.checkout_operation_key = operation_key
    membership.checkout_session_id = checkout.id
    membership.checkout_expires_at = datetime.fromtimestamp(checkout.expires_at, UTC)
    db.commit()
    return CheckoutResult(url=checkout.url)
