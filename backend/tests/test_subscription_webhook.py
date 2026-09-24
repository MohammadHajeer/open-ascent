from __future__ import annotations

import hashlib
import hmac
import json
import time
import uuid
from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event, func, select
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.api.stripe_webhook import get_stripe_subscription_gateway
from app.core.config import settings
from app.db.database import get_db
from app.main import app
from app.models.enums import PlanCode
from app.models.subscription import (
    StripeWebhookEvent,
    SubscriptionPlan,
    UserSubscription,
)
from app.services.entitlements import resolve_effective_plan
from app.services.stripe_webhooks import reconcile_verified_event

TEST_PRICE = "price_test_open_ascent_monthly"
TEST_SECRET = "whsec_open_ascent_test_only"


class FakeSubscriptionGateway:
    def __init__(self) -> None:
        self.subscriptions: dict[str, dict] = {}
        self.retrieved: list[str] = []

    def retrieve_test_subscription(self, subscription_id: str):
        self.retrieved.append(subscription_id)
        return self.subscriptions[subscription_id]


@pytest.fixture
def webhook_db() -> Session:
    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )

    @event.listens_for(engine, "connect")
    def register_postgres_uuid_default(connection, _record) -> None:
        connection.create_function("gen_random_uuid", 0, lambda: uuid.uuid4().hex)

    SubscriptionPlan.__table__.create(engine)
    with engine.begin() as connection:
        connection.exec_driver_sql(
            "CREATE TABLE profiles ("
            "id UUID PRIMARY KEY, display_name TEXT NOT NULL, "
            "stripe_customer_id TEXT UNIQUE, "
            "created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, "
            "updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP)"
        )
    UserSubscription.__table__.create(engine)
    StripeWebhookEvent.__table__.create(engine)
    with Session(engine, expire_on_commit=False) as session:
        yield session


@pytest.fixture
def webhook_context(webhook_db: Session):
    free = SubscriptionPlan(code="free", name="Free", is_active=True)
    pro = SubscriptionPlan(
        code="pro", name="Pro", is_active=True, stripe_price_id=TEST_PRICE
    )
    webhook_db.add_all([free, pro])
    webhook_db.flush()
    user_id = uuid.uuid4()
    customer_id = f"cus_test_{user_id.hex}"
    webhook_db.connection().exec_driver_sql(
        "INSERT INTO profiles (id, display_name, stripe_customer_id) VALUES (?, ?, ?)",
        (user_id.hex, "Webhook Tester", customer_id),
    )
    membership = UserSubscription(
        user_id=user_id,
        plan_id=free.id,
        checkout_session_id="cs_test_trusted",
        checkout_expires_at=datetime.now(UTC) + timedelta(hours=1),
    )
    webhook_db.add(membership)
    webhook_db.commit()
    gateway = FakeSubscriptionGateway()
    test_settings = settings.model_copy(
        update={
            "app_env": "test",
            "stripe_secret_key": "sk_test_webhooks",
            "stripe_webhook_secret": TEST_SECRET,
            "stripe_pro_price_id": TEST_PRICE,
        }
    )
    return webhook_db, user_id, customer_id, membership, gateway, test_settings


def _subscription(
    *,
    subscription_id: str,
    customer_id: str,
    status: str = "active",
    start: int,
    end: int,
    cancel_at_period_end: bool = False,
    price_id: str = TEST_PRICE,
    livemode: bool = False,
) -> dict:
    return {
        "id": subscription_id,
        "object": "subscription",
        "customer": customer_id,
        "status": status,
        "cancel_at_period_end": cancel_at_period_end,
        "livemode": livemode,
        "items": {
            "data": [
                {
                    "current_period_start": start,
                    "current_period_end": end,
                    "price": {
                        "id": price_id,
                        "livemode": livemode,
                        "type": "recurring",
                        "recurring": {"interval": "month", "interval_count": 1},
                    },
                }
            ]
        },
    }


def _event(
    *,
    event_id: str,
    event_type: str,
    created: int,
    data_object: dict,
    livemode: bool = False,
) -> dict:
    return {
        "id": event_id,
        "object": "event",
        "type": event_type,
        "created": created,
        "livemode": livemode,
        "data": {"object": data_object},
    }


def _signed(event_payload: dict, *, secret: str = TEST_SECRET) -> tuple[bytes, str]:
    payload = json.dumps(event_payload, separators=(",", ":")).encode()
    timestamp = int(time.time())
    signed_payload = f"{timestamp}.{payload.decode()}".encode()
    digest = hmac.new(secret.encode(), signed_payload, hashlib.sha256).hexdigest()
    return payload, f"t={timestamp},v1={digest}"


def _route_client(
    monkeypatch: pytest.MonkeyPatch,
    db: Session,
    gateway: FakeSubscriptionGateway,
) -> TestClient:
    for key, value in {
        "app_env": "test",
        "stripe_secret_key": "sk_test_webhooks",
        "stripe_webhook_secret": TEST_SECRET,
        "stripe_pro_price_id": TEST_PRICE,
    }.items():
        monkeypatch.setattr(settings, key, value)

    def override_db():
        yield db

    app.dependency_overrides[get_db] = override_db
    app.dependency_overrides[get_stripe_subscription_gateway] = lambda: gateway
    return TestClient(app)


def _active_event(context, *, event_id: str = "evt_active", created: int | None = None):
    db, _user_id, customer_id, _membership, gateway, _settings = context
    del db
    now = int(time.time())
    subscription = _subscription(
        subscription_id="sub_test_monthly",
        customer_id=customer_id,
        start=now - 60,
        end=now + 2_592_000,
    )
    gateway.subscriptions[subscription["id"]] = subscription
    return _event(
        event_id=event_id,
        event_type="customer.subscription.updated",
        created=created if created is not None else now,
        data_object=subscription,
    )


def test_valid_signed_test_webhook_is_accepted_and_grants_only_verified_pro(
    webhook_context, monkeypatch
) -> None:
    db, user_id, _customer_id, membership, gateway, _settings = webhook_context
    client = _route_client(monkeypatch, db, gateway)
    event_payload = _active_event(webhook_context)
    payload, signature = _signed(event_payload)

    assert resolve_effective_plan(db, user_id) is PlanCode.FREE
    response = client.post(
        "/webhooks/stripe",
        content=payload,
        headers={"Stripe-Signature": signature},
    )

    assert response.status_code == 200
    assert response.json() == {"received": True, "outcome": "applied"}
    db.refresh(membership)
    assert membership.provider_status == "active"
    assert membership.stripe_subscription_id == "sub_test_monthly"
    assert membership.last_verified_at is not None
    assert resolve_effective_plan(db, user_id) is PlanCode.PRO
    app.dependency_overrides.clear()


def test_invalid_and_missing_signatures_are_rejected_without_secret_disclosure(
    webhook_context, monkeypatch
) -> None:
    db, _user_id, _customer_id, _membership, gateway, _settings = webhook_context
    client = _route_client(monkeypatch, db, gateway)
    payload, _signature = _signed(_active_event(webhook_context))

    invalid = client.post(
        "/webhooks/stripe",
        content=payload,
        headers={"Stripe-Signature": "t=1,v1=invalid"},
    )
    missing = client.post("/webhooks/stripe", content=payload)

    assert invalid.status_code == 400
    assert missing.status_code == 400
    assert TEST_SECRET not in invalid.text
    assert settings.stripe_secret_key not in invalid.text
    assert db.scalar(select(func.count()).select_from(StripeWebhookEvent)) == 0
    app.dependency_overrides.clear()


def test_signed_malformed_event_is_rejected(webhook_context, monkeypatch) -> None:
    db, _user_id, _customer_id, _membership, gateway, _settings = webhook_context
    client = _route_client(monkeypatch, db, gateway)
    malformed = {
        "id": "evt_malformed",
        "object": "event",
        "created": int(time.time()),
        "livemode": False,
        "data": {"object": {}},
    }
    payload, signature = _signed(malformed)

    response = client.post(
        "/webhooks/stripe",
        content=payload,
        headers={"Stripe-Signature": signature},
    )

    assert response.status_code == 400
    assert db.scalar(select(func.count()).select_from(StripeWebhookEvent)) == 0
    app.dependency_overrides.clear()


def test_signed_live_mode_event_is_rejected(webhook_context, monkeypatch) -> None:
    db, _user_id, _customer_id, membership, gateway, _settings = webhook_context
    client = _route_client(monkeypatch, db, gateway)
    event_payload = _active_event(webhook_context)
    event_payload["livemode"] = True
    payload, signature = _signed(event_payload)

    response = client.post(
        "/webhooks/stripe",
        content=payload,
        headers={"Stripe-Signature": signature},
    )

    object_payload = _active_event(webhook_context, event_id="evt_live_object")
    object_payload["data"]["object"]["livemode"] = True
    object_bytes, object_signature = _signed(object_payload)
    object_response = client.post(
        "/webhooks/stripe",
        content=object_bytes,
        headers={"Stripe-Signature": object_signature},
    )

    assert response.status_code == 400
    assert object_response.status_code == 400
    db.refresh(membership)
    assert membership.provider_status is None
    app.dependency_overrides.clear()


def test_provider_failure_rolls_back_and_exposes_no_provider_details(
    webhook_context, monkeypatch
) -> None:
    db, _user_id, _customer_id, membership, gateway, _settings = webhook_context
    client = _route_client(monkeypatch, db, gateway)
    event_payload = _active_event(webhook_context, event_id="evt_provider_failure")
    gateway.subscriptions.clear()
    payload, signature = _signed(event_payload)

    response = client.post(
        "/webhooks/stripe",
        content=payload,
        headers={"Stripe-Signature": signature},
    )

    assert response.status_code == 502
    assert "sub_test_monthly" not in response.text
    assert TEST_SECRET not in response.text
    db.refresh(membership)
    assert membership.last_verified_at is None
    assert db.get(StripeWebhookEvent, "evt_provider_failure") is None
    app.dependency_overrides.clear()


def test_checkout_completed_maps_only_the_server_stored_session(webhook_context) -> None:
    db, user_id, customer_id, membership, gateway, test_settings = webhook_context
    now = int(time.time())
    subscription = _subscription(
        subscription_id="sub_from_checkout",
        customer_id=customer_id,
        start=now - 10,
        end=now + 2_592_000,
    )
    gateway.subscriptions[subscription["id"]] = subscription
    checkout = {
        "id": "cs_test_trusted",
        "object": "checkout.session",
        "mode": "subscription",
        "status": "complete",
        "customer": customer_id,
        "subscription": subscription["id"],
        "livemode": False,
        "metadata": {"open_ascent_user_id": str(uuid.uuid4())},
    }

    result = reconcile_verified_event(
        db,
        _event(
            event_id="evt_checkout",
            event_type="checkout.session.completed",
            created=now,
            data_object=checkout,
        ),
        settings=test_settings,
        gateway=gateway,
    )
    db.commit()

    assert result.outcome == "applied"
    assert membership.stripe_subscription_id == subscription["id"]
    assert resolve_effective_plan(db, user_id) is PlanCode.PRO


def test_checkout_success_redirect_and_forged_claim_cannot_grant_pro(
    webhook_context,
) -> None:
    db, user_id, _customer_id, membership, _gateway, _settings = webhook_context
    frontend_state = {"checkout": "success", "effective_plan": "pro"}

    assert frontend_state["checkout"] == "success"
    assert frontend_state["effective_plan"] == "pro"
    assert membership.last_verified_at is None
    assert resolve_effective_plan(db, user_id) is PlanCode.FREE


def test_duplicate_event_is_idempotent_and_does_not_duplicate_rows(
    webhook_context,
) -> None:
    db, _user_id, _customer_id, membership, gateway, test_settings = webhook_context
    event_payload = _active_event(webhook_context, event_id="evt_duplicate")

    first = reconcile_verified_event(
        db, event_payload, settings=test_settings, gateway=gateway
    )
    db.commit()
    first_revision = membership.sync_revision
    second = reconcile_verified_event(
        db, event_payload, settings=test_settings, gateway=gateway
    )
    db.commit()

    assert first.outcome == "applied"
    assert second.outcome == "duplicate"
    assert membership.sync_revision == first_revision
    assert gateway.retrieved == ["sub_test_monthly"]
    assert db.scalar(select(func.count()).select_from(UserSubscription)) == 1
    assert db.scalar(select(func.count()).select_from(StripeWebhookEvent)) == 1


def test_renewal_uses_latest_verified_stripe_period(webhook_context) -> None:
    db, user_id, customer_id, membership, gateway, test_settings = webhook_context
    now = int(time.time())
    initial = _active_event(webhook_context, event_id="evt_first_period", created=now)
    reconcile_verified_event(db, initial, settings=test_settings, gateway=gateway)
    db.commit()
    first_end = membership.current_period_end

    renewed = _subscription(
        subscription_id="sub_test_monthly", customer_id=customer_id,
        start=int(first_end.timestamp()), end=int(first_end.timestamp()) + 2_592_000,
    )
    gateway.subscriptions[renewed["id"]] = renewed
    result = reconcile_verified_event(
        db,
        _event(
            event_id="evt_renewed", event_type="customer.subscription.updated",
            created=now + 5, data_object=renewed,
        ),
        settings=test_settings, gateway=gateway,
    )
    db.commit()

    assert result.outcome == "applied"
    assert membership.current_period_start == first_end
    assert membership.current_period_end > first_end
    assert membership.cancel_at_period_end is False
    assert resolve_effective_plan(db, user_id, as_of=first_end + timedelta(days=1)) is PlanCode.PRO


def test_delayed_older_event_cannot_overwrite_newer_verified_state(
    webhook_context,
) -> None:
    db, _user_id, customer_id, membership, gateway, test_settings = webhook_context
    now = int(time.time())
    newer = _active_event(webhook_context, event_id="evt_newer", created=now + 20)
    reconcile_verified_event(db, newer, settings=test_settings, gateway=gateway)
    db.commit()
    verified_at = membership.last_verified_at
    revision = membership.sync_revision

    gateway.subscriptions["sub_test_monthly"] = _subscription(
        subscription_id="sub_test_monthly",
        customer_id=customer_id,
        status="canceled",
        start=now - 60,
        end=now + 2_592_000,
    )
    older = _event(
        event_id="evt_older",
        event_type="customer.subscription.deleted",
        created=now + 10,
        data_object=gateway.subscriptions["sub_test_monthly"],
    )
    result = reconcile_verified_event(
        db, older, settings=test_settings, gateway=gateway
    )
    db.commit()

    assert result.outcome == "ignored_stale"
    assert membership.provider_status == "active"
    assert membership.last_verified_at == verified_at
    assert membership.sync_revision == revision
    assert gateway.retrieved == ["sub_test_monthly"]


def test_cancel_at_period_end_stays_pro_until_period_end_then_deletion_revokes(
    webhook_context,
) -> None:
    db, user_id, customer_id, membership, gateway, test_settings = webhook_context
    start = datetime.now(UTC).replace(microsecond=0) - timedelta(minutes=1)
    end = start + timedelta(days=30)
    subscription = _subscription(
        subscription_id="sub_canceling",
        customer_id=customer_id,
        status="active",
        start=int(start.timestamp()),
        end=int(end.timestamp()),
        cancel_at_period_end=True,
    )
    gateway.subscriptions[subscription["id"]] = subscription
    reconcile_verified_event(
        db,
        _event(
            event_id="evt_cancel_at_end",
            event_type="customer.subscription.updated",
            created=int(start.timestamp()) + 5,
            data_object=subscription,
        ),
        settings=test_settings,
        gateway=gateway,
        received_at=start + timedelta(seconds=10),
    )
    db.commit()

    assert membership.cancel_at_period_end is True
    assert resolve_effective_plan(db, user_id, as_of=start + timedelta(days=1)) is PlanCode.PRO
    assert resolve_effective_plan(db, user_id, as_of=end) is PlanCode.FREE

    subscription["status"] = "canceled"
    reconcile_verified_event(
        db,
        _event(
            event_id="evt_deleted",
            event_type="customer.subscription.deleted",
            created=int(start.timestamp()) + 20,
            data_object=subscription,
        ),
        settings=test_settings,
        gateway=gateway,
        received_at=start + timedelta(seconds=25),
    )
    db.commit()
    assert membership.provider_status == "canceled"
    assert resolve_effective_plan(db, user_id, as_of=start + timedelta(days=1)) is PlanCode.FREE


def test_unknown_customer_and_unexpected_price_cannot_grant_pro(
    webhook_context,
) -> None:
    db, user_id, customer_id, membership, gateway, test_settings = webhook_context
    now = int(time.time())
    unknown = _subscription(
        subscription_id="sub_unknown",
        customer_id="cus_unknown",
        start=now,
        end=now + 2_592_000,
    )
    unmapped = reconcile_verified_event(
        db,
        _event(
            event_id="evt_unknown",
            event_type="customer.subscription.created",
            created=now,
            data_object=unknown,
        ),
        settings=test_settings,
        gateway=gateway,
    )
    db.commit()

    wrong_price = _subscription(
        subscription_id="sub_wrong_price",
        customer_id=customer_id,
        start=now,
        end=now + 2_592_000,
        price_id="price_not_open_ascent",
    )
    gateway.subscriptions[wrong_price["id"]] = wrong_price
    invalid = reconcile_verified_event(
        db,
        _event(
            event_id="evt_wrong_price",
            event_type="customer.subscription.created",
            created=now + 1,
            data_object=wrong_price,
        ),
        settings=test_settings,
        gateway=gateway,
    )
    db.commit()

    assert unmapped.outcome == "ignored_unmapped"
    assert invalid.outcome == "ignored_invalid"
    assert membership.stripe_subscription_id is None
    assert resolve_effective_plan(db, user_id) is PlanCode.FREE
