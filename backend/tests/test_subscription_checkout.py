from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event, select
from sqlalchemy.orm import Session

from app.api.dependencies.auth import get_current_user_id
from app.api.subscriptions import get_stripe_gateway
from app.core.config import settings
from app.db.database import get_db
from app.main import app
from app.models.enums import PlanCode
from app.models.profile import Profile
from app.models.subscription import SubscriptionPlan, UserSubscription
from app.services.entitlements import resolve_effective_plan
from app.services.stripe_checkout import (
    CheckoutConfigurationError,
    CheckoutProviderError,
    StripeTestGateway,
    create_pro_test_checkout,
    validate_test_checkout_config,
)

TEST_PRICE = "price_test_open_ascent_monthly"


class FakeStripeGateway:
    def __init__(self) -> None:
        self.validated_prices: list[str] = []
        self.created: list[dict[str, object]] = []
        self.sessions: dict[str, SimpleNamespace] = {}
        self.customers: dict[str, SimpleNamespace] = {}

    def validate_monthly_test_price(self, price_id: str) -> None:
        self.validated_prices.append(price_id)

    def get_test_customer(self, customer_id: str):
        return self.customers.get(customer_id)

    def create_test_customer(self, user_id: uuid.UUID, display_name: str):
        customer = SimpleNamespace(id=f"cus_test_{user_id.hex}", livemode=False)
        self.customers[customer.id] = customer
        return customer

    def get_open_checkout(self, session_id: str):
        return self.sessions.get(session_id)

    def create_subscription_checkout(self, **values):
        self.created.append(values)
        checkout = SimpleNamespace(
            id=f"cs_test_{len(self.created)}",
            url=f"https://checkout.stripe.com/c/pay/cs_test_{len(self.created)}",
            expires_at=int((datetime.now(UTC) + timedelta(hours=1)).timestamp()),
            livemode=False,
            status="open",
        )
        self.sessions[checkout.id] = checkout
        return checkout


@pytest.fixture
def subscription_db() -> Session:
    engine = create_engine("sqlite+pysqlite:///:memory:")

    @event.listens_for(engine, "connect")
    def register_postgres_uuid_default(connection, _record) -> None:
        connection.create_function("gen_random_uuid", 0, lambda: uuid.uuid4().hex)

    SubscriptionPlan.__table__.create(engine)
    with engine.begin() as connection:
        connection.exec_driver_sql(
            "CREATE TABLE profiles ("
            "id UUID PRIMARY KEY, display_name TEXT NOT NULL, "
            "app_role TEXT NOT NULL DEFAULT 'athlete', onboarding_completed_at TIMESTAMP, "
            "dashboard_tour_status TEXT NOT NULL DEFAULT 'not_started', "
            "coaching_context JSON NOT NULL DEFAULT '{}', "
            "initial_assessment JSON NOT NULL DEFAULT '{}', "
            "athlete_state JSON NOT NULL DEFAULT '{}', safety_ack_version TEXT, "
            "safety_acknowledged_at TIMESTAMP, stripe_customer_id TEXT UNIQUE, "
            "created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, "
            "updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP)"
        )
    UserSubscription.__table__.create(engine)

    with Session(engine, expire_on_commit=False) as session:
        yield session


@pytest.fixture
def checkout_context(subscription_db: Session):
    free = SubscriptionPlan(code="free", name="Free", is_active=True)
    pro = SubscriptionPlan(
        code="pro", name="Pro", is_active=True, stripe_price_id=TEST_PRICE
    )
    subscription_db.add_all([free, pro])
    subscription_db.flush()
    user_id = uuid.uuid4()
    subscription_db.connection().exec_driver_sql(
        "INSERT INTO profiles (id, display_name) VALUES (?, ?)",
        (user_id.hex, "Checkout Tester"),
    )
    subscription_db.add(UserSubscription(user_id=user_id, plan_id=free.id))
    subscription_db.commit()
    gateway = FakeStripeGateway()
    test_settings = settings.model_copy(
        update={
            "app_env": "test",
            "stripe_secret_key": "sk_test_checkout",
            "stripe_pro_price_id": TEST_PRICE,
            "frontend_url": "http://localhost:3000",
        }
    )
    return subscription_db, user_id, gateway, test_settings


def test_free_user_starts_server_selected_monthly_subscription_checkout(
    checkout_context,
) -> None:
    db, user_id, gateway, test_settings = checkout_context
    result = create_pro_test_checkout(
        db, user_id=user_id, settings=test_settings, gateway=gateway
    )

    assert result.url.startswith("https://checkout.stripe.com/")
    assert gateway.validated_prices == [TEST_PRICE]
    assert len(gateway.created) == 1
    created = gateway.created[0]
    assert created["price_id"] == TEST_PRICE
    assert created["success_url"] == (
        "http://localhost:3000/dashboard/settings?checkout=success"
    )
    assert created["cancel_url"] == (
        "http://localhost:3000/dashboard/settings?checkout=cancelled"
    )
    assert created["user_id"] == user_id
    assert resolve_effective_plan(db, user_id) is PlanCode.FREE


def test_checkout_reuses_customer_and_open_session(checkout_context) -> None:
    db, user_id, gateway, test_settings = checkout_context
    first = create_pro_test_checkout(
        db, user_id=user_id, settings=test_settings, gateway=gateway
    )
    profile = db.get(Profile, user_id)
    assert profile is not None
    customer_id = profile.stripe_customer_id

    second = create_pro_test_checkout(
        db, user_id=user_id, settings=test_settings, gateway=gateway
    )

    assert second == first
    assert profile.stripe_customer_id == customer_id
    assert len(gateway.created) == 1


def test_effective_pro_user_cannot_start_redundant_checkout(checkout_context) -> None:
    db, user_id, gateway, test_settings = checkout_context
    pro = db.scalar(
        select(SubscriptionPlan).where(SubscriptionPlan.code == PlanCode.PRO.value)
    )
    membership = db.scalar(
        select(UserSubscription).where(UserSubscription.user_id == user_id)
    )
    assert pro is not None and membership is not None
    now = datetime.now(UTC)
    membership.plan_id = pro.id
    membership.provider_status = "active"
    membership.stripe_subscription_id = f"sub_test_{user_id.hex}"
    membership.last_verified_at = now
    membership.effective_start = now - timedelta(days=1)
    membership.effective_end = now + timedelta(days=29)
    membership.current_period_start = now - timedelta(days=1)
    membership.current_period_end = now + timedelta(days=29)
    db.commit()

    with pytest.raises(RuntimeError, match="already has Pro"):
        create_pro_test_checkout(
            db, user_id=user_id, settings=test_settings, gateway=gateway
        )
    assert gateway.created == []


def test_provider_failure_is_clean(checkout_context) -> None:
    db, user_id, gateway, test_settings = checkout_context

    def fail(_price_id: str) -> None:
        raise RuntimeError("provider-secret-detail")

    gateway.validate_monthly_test_price = fail
    with pytest.raises(CheckoutProviderError, match="temporarily unavailable") as error:
        create_pro_test_checkout(
            db, user_id=user_id, settings=test_settings, gateway=gateway
        )
    assert "provider-secret-detail" not in str(error.value)


def test_stripe_gateway_creates_subscription_mode_with_internal_reference() -> None:
    captured: dict[str, object] = {}

    class Sessions:
        def create(self, params, options):
            captured["params"] = params
            captured["options"] = options
            return SimpleNamespace(livemode=False, url="https://checkout.stripe.com/test")

    gateway = StripeTestGateway.__new__(StripeTestGateway)
    gateway.client = SimpleNamespace(
        v1=SimpleNamespace(checkout=SimpleNamespace(sessions=Sessions()))
    )
    user_id = uuid.uuid4()
    gateway.create_subscription_checkout(
        user_id=user_id,
        customer_id="cus_test_existing",
        price_id=TEST_PRICE,
        success_url="https://app.test/dashboard/settings?checkout=success",
        cancel_url="https://app.test/dashboard/settings?checkout=cancelled",
        operation_key="operation-key",
    )

    params = captured["params"]
    assert params["mode"] == "subscription"
    assert params["line_items"] == [{"price": TEST_PRICE, "quantity": 1}]
    assert params["client_reference_id"] == str(user_id)
    assert params["subscription_data"]["metadata"] == {
        "open_ascent_user_id": str(user_id)
    }
    assert captured["options"] == {"idempotency_key": "operation-key"}


@pytest.mark.parametrize(
    ("updates", "message"),
    [
        ({"app_env": "production"}, "disabled"),
        ({"stripe_secret_key": "sk_live_forbidden"}, "test secret"),
        ({"stripe_pro_price_id": "price_other"}, "does not match"),
    ],
)
def test_test_mode_configuration_safeguards(updates, message) -> None:
    candidate = settings.model_copy(update=updates)
    with pytest.raises(CheckoutConfigurationError, match=message):
        validate_test_checkout_config(candidate, TEST_PRICE)


def test_missing_price_configuration_fails_safely() -> None:
    candidate = settings.model_copy(
        update={"app_env": "test", "stripe_secret_key": "sk_test_checkout"}
    )
    with pytest.raises(CheckoutConfigurationError, match="test Pro price"):
        validate_test_checkout_config(candidate, None)


def test_checkout_route_requires_authentication() -> None:
    app.dependency_overrides[get_db] = lambda: None
    try:
        with TestClient(app) as client:
            assert client.post("/subscriptions/checkout").status_code == 401
    finally:
        app.dependency_overrides.pop(get_db, None)


def test_checkout_route_does_not_accept_client_pricing(monkeypatch) -> None:
    captured: dict[str, object] = {}
    user_id = uuid.uuid4()

    def fake_checkout(_db, **values):
        captured.update(values)
        return SimpleNamespace(url="https://checkout.stripe.com/c/pay/server-choice")

    monkeypatch.setattr("app.api.subscriptions.create_pro_test_checkout", fake_checkout)
    app.dependency_overrides[get_db] = lambda: object()
    app.dependency_overrides[get_current_user_id] = lambda: user_id
    app.dependency_overrides[get_stripe_gateway] = lambda: FakeStripeGateway()
    try:
        with TestClient(app) as client:
            response = client.post(
                "/subscriptions/checkout",
                json={"price_id": "price_live_client", "amount": 1},
            )
    finally:
        app.dependency_overrides.pop(get_db, None)
        app.dependency_overrides.pop(get_current_user_id, None)
        app.dependency_overrides.pop(get_stripe_gateway, None)

    assert response.status_code == 200
    assert response.json()["url"].endswith("server-choice")
    assert "price_id" not in captured
    assert captured["user_id"] == user_id
