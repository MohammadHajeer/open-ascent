"""Free daily AI Coach allowance on the shared usage ledger.

The SQLite tests exercise the real entitlement catalog, ledger admission, Coach
reservation, and API mapping. SQLite cannot run PostgreSQL advisory locks, so a
separate real-PostgreSQL test covers concurrent admission of the last unit.
"""

from __future__ import annotations

import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from threading import Barrier

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, delete, event, func, select, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

import app.api.coach as coach_api
from app.api.dependencies.auth import require_athlete
from app.db.database import SessionLocal, get_db
from app.main import app
from app.models.coach import CoachGeneration, Conversation, Message
from app.models.enums import FeatureKey, FeatureUsageStatus, PlanCode
from app.models.profile import Profile
from app.models.subscription import (
    FeatureUsage,
    PlanEntitlement,
    SubscriptionPlan,
    UserSubscription,
)
from app.models.training import TrainingPlan, TrainingPlanPreview
from app.services import coach
from app.services import feature_usage as usage_service
from app.services.entitlements import seed_plan_catalog
from app.services.feature_usage import (
    QuotaExceededError,
    calendar_day_window,
    release_usage,
    reserve_usage,
    usage_summary,
)
from app.subscriptions.catalog import FREE_AI_COACH_DAILY_MESSAGES


@compiles(JSONB, "sqlite")
def _jsonb_sqlite(_type, _compiler, **_kwargs):
    return "JSON"


@pytest.fixture
def quota_db(monkeypatch):
    engine = create_engine(
        "sqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False}
    )

    @event.listens_for(engine, "connect")
    def register_functions(connection, _record):
        connection.create_function("gen_random_uuid", 0, lambda: uuid.uuid4().hex)
        connection.create_function("now", 0, lambda: datetime.now(UTC).isoformat())

    tables = (
        Profile.__table__, Conversation.__table__, Message.__table__,
        CoachGeneration.__table__, TrainingPlan.__table__,
        TrainingPlanPreview.__table__, SubscriptionPlan.__table__,
        PlanEntitlement.__table__, UserSubscription.__table__, FeatureUsage.__table__,
    )
    defaults = [
        (column, column.server_default)
        for table in tables for column in table.columns
        if isinstance(column.type, JSONB)
    ]
    for column, _default in defaults:
        column.server_default = None
    try:
        for table in tables:
            table.create(engine)
    finally:
        for column, default in defaults:
            column.server_default = default
    factory = sessionmaker(engine, expire_on_commit=False)
    with factory() as db:
        seed_plan_catalog(db, pro_stripe_price_id="price_test_coach_quota")
        db.commit()
    # SQLite has no advisory locks; the PostgreSQL test below covers them.
    monkeypatch.setattr(usage_service, "_lock_admission", lambda *_args: None)
    monkeypatch.setattr(coach, "SessionLocal", factory)
    monkeypatch.setattr(coach_api, "SessionLocal", factory)
    started: list[uuid.UUID] = []
    monkeypatch.setattr(
        coach, "start_generation", lambda generation_id, _user_id: started.append(generation_id)
    )
    yield factory, started
    engine.dispose()


def _athlete(db: Session) -> Profile:
    profile = Profile(
        id=uuid.uuid4(), display_name="Athlete", coaching_context={},
        initial_assessment={}, athlete_state={},
    )
    db.add(profile)
    db.commit()
    return profile


def _make_pro(db: Session, user_id: uuid.UUID) -> None:
    now = datetime.now(UTC)
    plan = db.scalar(select(SubscriptionPlan).where(SubscriptionPlan.code == PlanCode.PRO.value))
    db.add(UserSubscription(
        user_id=user_id, plan_id=plan.id, provider_status="active",
        effective_start=now - timedelta(days=1), effective_end=now + timedelta(days=29),
        current_period_start=now - timedelta(days=1),
        current_period_end=now + timedelta(days=29),
        stripe_subscription_id=f"sub_{uuid.uuid4().hex}",
        last_verified_at=now - timedelta(hours=1),
    ))
    db.commit()


def _coach_usage_rows(factory, user_id: uuid.UUID, feature: FeatureKey = FeatureKey.AI_COACH_REPLY) -> list[FeatureUsage]:
    with factory() as db:
        return list(db.scalars(select(FeatureUsage).where(
            FeatureUsage.user_id == user_id, FeatureUsage.feature_key == feature.value,
        )))


@pytest.fixture
def api(quota_db):
    factory, started = quota_db
    identity: dict[str, Profile | None] = {"profile": None}

    def database():
        with factory() as db:
            yield db

    app.dependency_overrides[get_db] = database
    app.dependency_overrides[require_athlete] = lambda: identity["profile"]
    try:
        with TestClient(app) as client:
            yield client, factory, started, identity
    finally:
        app.dependency_overrides.clear()


def _send(client: TestClient, conversation_id: str | None, content: str,
          request_id: str | None = None, kind: str = "chat"):
    body = {"client_request_id": request_id or str(uuid.uuid4()), "content": content, "kind": kind}
    path = (
        f"/coach/conversations/{conversation_id}/messages"
        if conversation_id else "/coach/conversations/messages"
    )
    return client.post(path, json=body)


def _finish(generation_id: str, status: str = "completed", **state) -> None:
    state.setdefault("provider_response_id", f"resp_{generation_id}")
    coach._set_state(uuid.UUID(generation_id), status, content="Answer.", **state)


def test_free_catalog_defines_one_central_daily_coach_allowance(quota_db):
    factory, _started = quota_db
    with factory() as db:
        owner = _athlete(db)
        summary = usage_summary(db, owner.id, FeatureKey.AI_COACH_REPLY)
    assert FREE_AI_COACH_DAILY_MESSAGES == 5
    assert summary.as_dict() | {"resets_at": None} == {
        "tier": "free", "allowed": True, "unlimited": False, "limit": 5,
        "used": 0, "remaining": 5, "period": "day", "resets_at": None,
    }


def test_free_user_sends_five_messages_then_sixth_is_refused_before_provider(api):
    client, factory, started, identity = api
    with factory() as db:
        owner = _athlete(db)
    identity["profile"] = owner

    first = _send(client, None, "How do I improve my Pull-Ups?")
    assert first.status_code == 202
    conversation_id = first.json()["conversation"]["id"]
    generation_ids = [first.json()["generation_id"]]
    _finish(generation_ids[0])
    assert client.get("/coach/usage").json()["remaining"] == 4
    last_request = None
    for number in range(2, 6):
        last_request = str(uuid.uuid4())
        sent = _send(client, conversation_id, f"Follow-up question {number}", last_request)
        assert sent.status_code == 202
        generation_ids.append(sent.json()["generation_id"])
        _finish(generation_ids[-1])
        assert client.get("/coach/usage").json()["remaining"] == 5 - number

    usage = client.get("/coach/usage").json()
    assert (usage["tier"], usage["used"], usage["remaining"], usage["limit"]) == ("free", 5, 0, 5)
    assert usage["allowed"] is False and usage["period"] == "day"

    refused = _send(client, conversation_id, "One more question")
    assert refused.status_code == 429
    error = refused.json()["error"]
    assert error["code"] == "coach_daily_quota_exhausted"
    assert (error["details"]["remaining"], error["details"]["limit"]) == (0, 5)
    # The refusal happens before any generation, message, or provider call.
    assert started == [uuid.UUID(item) for item in generation_ids]
    with factory() as db:
        assert db.scalar(select(func.count(Message.id))) == 10
        assert db.scalar(select(func.count(CoachGeneration.id))) == 5
    assert client.get(f"/coach/conversations/{conversation_id}").status_code == 200
    assert len(_coach_usage_rows(factory, owner.id)) == 5

    # A retry of an accepted send is a replay, never a second charge.
    replay = _send(client, conversation_id, "Follow-up question 5", last_request)
    assert replay.status_code == 202 and replay.json()["created"] is False
    assert len(_coach_usage_rows(factory, owner.id)) == 5

    # A refused first send must not leave a new empty conversation behind.
    assert _send(client, None, "Start another chat").status_code == 429
    assert len(client.get("/coach/conversations").json()) == 1

    # Pain and injury guidance is never paywalled, even at the limit.
    safety = _send(client, conversation_id, "My shoulder hurts during pull-ups")
    assert safety.status_code == 202
    assert len(_coach_usage_rows(factory, owner.id)) == 5


def test_reconnect_and_duplicate_reservation_do_not_double_charge(api):
    client, factory, _started, identity = api
    with factory() as db:
        owner = _athlete(db)
    identity["profile"] = owner
    request_id = str(uuid.uuid4())
    sent = _send(client, None, "What is a false grip?", request_id)
    conversation_id = sent.json()["conversation"]["id"]
    generation_id = sent.json()["generation_id"]
    again = _send(client, None, "What is a false grip?", request_id)
    assert again.json()["generation_id"] == generation_id and again.json()["created"] is False
    for _ in range(2):
        assert client.get(
            f"/coach/conversations/{conversation_id}/generations/{generation_id}"
        ).status_code == 200
    rows = _coach_usage_rows(factory, owner.id)
    assert len(rows) == 1 and rows[0].operation_key == request_id


def test_daily_allowance_resets_at_the_utc_day_boundary(quota_db):
    factory, _started = quota_db
    late = datetime(2026, 9, 26, 23, 59, 59, tzinfo=UTC)
    next_day = datetime(2026, 9, 27, 0, 0, tzinfo=UTC)
    with factory() as db:
        owner = _athlete(db)

        def reserve(key: str, at: datetime):
            return reserve_usage(
                db, user_id=owner.id, feature_key=FeatureKey.AI_COACH_REPLY,
                operation_key=key, request_fingerprint=f"fp:{key}",
                reservation_expires_at=at + timedelta(minutes=15), as_of=at,
            )

        for number in range(5):
            usage = reserve(f"late-{number}", late)
            assert (usage.window_start, usage.window_end) == calendar_day_window(late)
        with pytest.raises(QuotaExceededError):
            reserve("late-6", late)
        summary = usage_summary(db, owner.id, FeatureKey.AI_COACH_REPLY, as_of=late)
        assert (summary.used, summary.remaining, summary.resets_at) == (5, 0, next_day)
        assert reserve("late-1", late).operation_key == "late-1"

        fresh = reserve("next-day", next_day)
        assert fresh.window_start == next_day
        summary = usage_summary(db, owner.id, FeatureKey.AI_COACH_REPLY, as_of=next_day)
        assert (summary.used, summary.remaining) == (1, 4)


def test_provider_rejection_before_response_returns_the_message(api):
    client, factory, _started, identity = api
    with factory() as db:
        owner = _athlete(db)
    identity["profile"] = owner
    sent = _send(client, None, "Plan my rest days")
    _finish(sent.json()["generation_id"], "failed", provider_response_id=None, error_code="provider_rejected")
    assert [row.status for row in _coach_usage_rows(factory, owner.id)] == [FeatureUsageStatus.RELEASED.value]
    assert client.get("/coach/usage").json()["remaining"] == 5


def test_pro_user_has_full_coach_access_without_a_daily_cap(api):
    client, factory, started, identity = api
    with factory() as db:
        owner = _athlete(db)
        _make_pro(db, owner.id)
    identity["profile"] = owner
    usage = client.get("/coach/usage").json()
    assert usage == {"tier": "pro", "allowed": True, "unlimited": True, "limit": None,
                     "used": 0, "remaining": None, "period": None, "resets_at": None}
    conversation_id = None
    for number in range(FREE_AI_COACH_DAILY_MESSAGES + 2):
        sent = _send(client, conversation_id, f"Question {number}")
        assert sent.status_code == 202
        conversation_id = conversation_id or sent.json()["conversation"]["id"]
        _finish(sent.json()["generation_id"])
    assert len(started) == FREE_AI_COACH_DAILY_MESSAGES + 2
    assert _coach_usage_rows(factory, owner.id) == []


def test_unauthenticated_coach_requests_are_rejected():
    with TestClient(app) as client:
        assert client.get("/coach/usage").status_code == 401
        assert _send(client, None, "Hello").status_code == 401


def test_sending_to_another_athletes_conversation_consumes_nothing(api):
    client, factory, started, identity = api
    with factory() as db:
        owner, stranger = _athlete(db), _athlete(db)
    identity["profile"] = stranger
    theirs = _send(client, None, "Stranger's question")
    identity["profile"] = owner
    response = _send(client, theirs.json()["conversation"]["id"], "Let me in")
    assert response.status_code == 404
    assert _coach_usage_rows(factory, owner.id) == []
    assert client.get("/coach/usage").json()["used"] == 0
    assert client.get("/coach/conversations").json() == []
    assert len(started) == 1


def test_coach_plan_turn_uses_the_monthly_plan_allowance_not_coach_messages(api):
    client, factory, started, identity = api
    with factory() as db:
        owner = _athlete(db)
    identity["profile"] = owner
    plan = _send(client, None, "Build me a weekly plan", kind="plan")
    assert plan.status_code == 202
    conversation_id = plan.json()["conversation"]["id"]
    _finish(plan.json()["generation_id"])
    plan_rows = _coach_usage_rows(factory, owner.id, FeatureKey.TRAINING_PLAN_GENERATION)
    assert [row.status for row in plan_rows] == [FeatureUsageStatus.CONSUMED.value]
    assert client.get("/coach/usage").json()["used"] == 0

    # Coach access never becomes a second path around Free's 1 plan/month.
    again = _send(client, conversation_id, "Build me another weekly plan", kind="plan")
    assert again.status_code == 403
    assert again.json()["error"]["code"] == "plan_generation_quota_exhausted"
    assert len(started) == 1
    chat = _send(client, conversation_id, "Why these exercises?")
    assert chat.status_code == 202
    assert client.get("/coach/usage").json()["remaining"] == 4


def test_released_plan_unit_can_be_retried_but_consumed_unit_cannot(quota_db):
    factory, _started = quota_db
    at = datetime.now(UTC)
    with factory() as db:
        owner = _athlete(db)
        first = reserve_usage(
            db, user_id=owner.id, feature_key=FeatureKey.TRAINING_PLAN_GENERATION,
            operation_key="plan-1", request_fingerprint="fp:1",
            reservation_expires_at=at + timedelta(minutes=15), as_of=at,
        )
        release_usage(db, first.id, reason="no_ready_movements")
        second = reserve_usage(
            db, user_id=owner.id, feature_key=FeatureKey.TRAINING_PLAN_GENERATION,
            operation_key="plan-2", request_fingerprint="fp:2",
            reservation_expires_at=at + timedelta(minutes=15), as_of=at,
        )
        assert second is not None
        with pytest.raises(QuotaExceededError):
            reserve_usage(
                db, user_id=owner.id, feature_key=FeatureKey.TRAINING_PLAN_GENERATION,
                operation_key="plan-3", request_fingerprint="fp:3",
                reservation_expires_at=at + timedelta(minutes=15), as_of=at,
            )


def _free_coach_entitlement(db: Session) -> PlanEntitlement:
    return db.scalar(
        select(PlanEntitlement)
        .join(SubscriptionPlan, SubscriptionPlan.id == PlanEntitlement.plan_id)
        .where(
            SubscriptionPlan.code == PlanCode.FREE.value,
            PlanEntitlement.feature_key == FeatureKey.AI_COACH_REPLY.value,
        )
    )


def test_concurrent_sends_cannot_exceed_the_free_cap_real_postgres() -> None:
    """Two simultaneous sends for the final unit admit exactly one."""
    user_id = uuid.uuid4()
    original = None
    try:
        with SessionLocal() as setup:
            setup.execute(text("INSERT INTO auth.users (id) VALUES (:id)"), {"id": user_id})
            setup.add(Profile(id=user_id, display_name="concurrent coach quota test"))
            setup.flush()
            entitlement = _free_coach_entitlement(setup)
            original = (entitlement.entitlement_type, entitlement.enabled,
                        entitlement.allowance_units, entitlement.reset_policy)
            migrated = setup.scalar(text("SELECT version_num FROM alembic_version")) == "e9f0a1b2c3d4"
            # Before the daily-reset migration is applied, the database only
            # accepts monthly windows; the admission lock is policy-independent.
            policy = "calendar_day_utc" if migrated else "calendar_month_utc"
            entitlement.entitlement_type = "metered"
            entitlement.enabled = True
            entitlement.allowance_units = FREE_AI_COACH_DAILY_MESSAGES
            entitlement.reset_policy = policy
            setup.flush()
            now = setup.scalar(select(func.now()))
            window = usage_service.usage_window(policy, now)
            for number in range(FREE_AI_COACH_DAILY_MESSAGES - 1):
                setup.add(FeatureUsage(
                    user_id=user_id, entitlement_id=entitlement.id,
                    feature_key=FeatureKey.AI_COACH_REPLY.value,
                    operation_key=f"earlier-{number}", request_fingerprint="earlier",
                    units=1, window_start=window[0], window_end=window[1],
                    status="consumed", reservation_expires_at=now + timedelta(minutes=15),
                    settled_at=now,
                ))
            conversations = [Conversation(user_id=user_id, title="New chat") for _ in range(2)]
            setup.add_all(conversations)
            setup.commit()
            conversation_ids = [item.id for item in conversations]

        barrier = Barrier(2)

        def attempt(conversation_id: uuid.UUID) -> str:
            with SessionLocal() as session:
                profile = session.get(Profile, user_id)
                barrier.wait(timeout=10)
                try:
                    coach.reserve_generation(
                        session, profile, conversation_id, uuid.uuid4(), "How do I train dips?"
                    )
                    return "admitted"
                except QuotaExceededError:
                    session.rollback()
                    return "denied"

        with ThreadPoolExecutor(max_workers=2) as executor:
            outcomes = list(executor.map(attempt, conversation_ids))
        assert sorted(outcomes) == ["admitted", "denied"]
        with SessionLocal() as verify:
            admitted = verify.scalar(select(func.count(FeatureUsage.id)).where(
                FeatureUsage.user_id == user_id,
                FeatureUsage.status.in_(("reserved", "consumed")),
            ))
            assert admitted == FREE_AI_COACH_DAILY_MESSAGES
            assert verify.scalar(select(func.count(CoachGeneration.id)).where(
                CoachGeneration.conversation_id.in_(conversation_ids)
            )) == 1
    finally:
        with SessionLocal() as cleanup:
            conversation_filter = Conversation.user_id == user_id
            ids = list(cleanup.scalars(select(Conversation.id).where(conversation_filter)))
            if ids:
                cleanup.execute(delete(CoachGeneration).where(CoachGeneration.conversation_id.in_(ids)))
                cleanup.execute(delete(Message).where(Message.conversation_id.in_(ids)))
                cleanup.execute(delete(Conversation).where(conversation_filter))
            cleanup.execute(delete(FeatureUsage).where(FeatureUsage.user_id == user_id))
            cleanup.execute(text("DELETE FROM profiles WHERE id = :id"), {"id": user_id})
            cleanup.execute(text("DELETE FROM auth.users WHERE id = :id"), {"id": user_id})
            if original is not None:
                entitlement = _free_coach_entitlement(cleanup)
                (entitlement.entitlement_type, entitlement.enabled,
                 entitlement.allowance_units, entitlement.reset_policy) = original
            cleanup.commit()
