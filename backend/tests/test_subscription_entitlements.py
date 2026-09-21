from __future__ import annotations

import uuid
from datetime import UTC, datetime

import pytest
from sqlalchemy import create_engine, event, func, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.safety import GLOBAL_SAFETY_GUIDANCE
from app.models.enums import EntitlementType, FeatureKey, PlanCode, ResetPolicy
from app.models.subscription import PlanEntitlement, SubscriptionPlan
from app.services.entitlements import (
    UnconfiguredAllowanceError,
    get_feature_allowance,
    get_user_entitlement,
    get_user_plan,
    is_feature_enabled,
    resolve_effective_plan,
    seed_plan_catalog,
)
from app.subscriptions.catalog import PLAN_CATALOG, EntitlementDefinition

EXPECTED_FEATURES = {
    FeatureKey.VIDEO_ANALYSIS,
    FeatureKey.AI_COACH_REPLY,
    FeatureKey.TRAINING_PLAN_GENERATION,
    FeatureKey.LIVE_COACH,
    FeatureKey.ADAPTIVE_TRAINING_PLANS,
    FeatureKey.ADVANCED_PROGRESS_INSIGHTS,
}


@pytest.fixture
def subscription_db() -> Session:
    engine = create_engine("sqlite+pysqlite:///:memory:")

    @event.listens_for(engine, "connect")
    def register_postgres_uuid_default(connection, _record) -> None:
        connection.create_function(
            "gen_random_uuid",
            0,
            lambda: str(uuid.uuid4()),
        )

    SubscriptionPlan.__table__.create(engine)
    PlanEntitlement.__table__.create(engine)
    # The resolver only joins these two columns. Keeping this local table small
    # avoids pulling the external Supabase auth schema into unit tests.
    with engine.begin() as connection:
        connection.exec_driver_sql(
            "CREATE TABLE user_subscriptions "
            "(user_id UUID UNIQUE NOT NULL, plan_id UUID NOT NULL, "
            "provider_status TEXT, effective_start TIMESTAMP, effective_end TIMESTAMP, "
            "current_period_start TIMESTAMP, current_period_end TIMESTAMP, "
            "cancel_at_period_end BOOLEAN NOT NULL DEFAULT 0, "
            "stripe_subscription_id TEXT, last_verified_at TIMESTAMP)"
        )

    with Session(engine, expire_on_commit=False) as session:
        yield session


@pytest.fixture
def seeded_catalog(subscription_db: Session) -> Session:
    seed_plan_catalog(
        subscription_db,
        pro_stripe_price_id="price_test_subscription_entitlements",
        effective_from=datetime(2026, 9, 21, tzinfo=UTC),
    )
    return subscription_db


def attach_subscription(
    db: Session,
    *,
    user_id: uuid.UUID,
    plan_code: PlanCode,
    provider_status: str | None = "active",
    start: datetime | None = datetime(2026, 9, 1, tzinfo=UTC),
    end: datetime | None = datetime(2026, 10, 1, tzinfo=UTC),
    period_start: datetime | None = datetime(2026, 9, 1, tzinfo=UTC),
    period_end: datetime | None = datetime(2026, 10, 1, tzinfo=UTC),
    provider_id: str | None = "sub_test",
    verified_at: datetime | None = datetime(2026, 9, 1, tzinfo=UTC),
) -> None:
    plan = db.scalar(
        select(SubscriptionPlan).where(SubscriptionPlan.code == plan_code.value)
    )
    assert plan is not None
    db.execute(
        text(
            "INSERT INTO user_subscriptions "
            "(user_id, plan_id, provider_status, effective_start, effective_end, "
            "current_period_start, current_period_end, stripe_subscription_id, "
            "last_verified_at) VALUES "
            "(:user_id, :plan_id, :provider_status, :start, :end, :period_start, "
            ":period_end, :provider_id, :verified_at)"
        ),
        {
            "user_id": user_id.hex,
            "plan_id": str(plan.id),
            "provider_status": provider_status,
            "start": start,
            "end": end,
            "period_start": period_start,
            "period_end": period_end,
            "provider_id": provider_id,
            "verified_at": verified_at,
        },
    )


def test_free_and_pro_exist_with_central_entitlements(
    seeded_catalog: Session,
) -> None:
    plans = seeded_catalog.scalars(
        select(SubscriptionPlan).where(
            SubscriptionPlan.code.in_((PlanCode.FREE, PlanCode.PRO))
        )
    ).all()

    assert {PlanCode(plan.code) for plan in plans} == {PlanCode.FREE, PlanCode.PRO}
    for plan in plans:
        keys = set(
            seeded_catalog.scalars(
                select(PlanEntitlement.feature_key).where(
                    PlanEntitlement.plan_id == plan.id
                )
            )
        )
        assert keys == {feature.value for feature in EXPECTED_FEATURES}

    live_coach = {
        PlanCode(plan.code): seeded_catalog.scalar(
            select(PlanEntitlement.enabled).where(
                PlanEntitlement.plan_id == plan.id,
                PlanEntitlement.feature_key == FeatureKey.LIVE_COACH,
            )
        )
        for plan in plans
    }
    assert live_coach == {PlanCode.FREE: False, PlanCode.PRO: True}


def test_seed_is_idempotent(seeded_catalog: Session) -> None:
    before = seeded_catalog.execute(
        select(
            PlanEntitlement.id,
            PlanEntitlement.revision,
            PlanEntitlement.effective_from,
        ).order_by(PlanEntitlement.id)
    ).all()

    seed_plan_catalog(
        seeded_catalog,
        pro_stripe_price_id="price_test_subscription_entitlements",
        effective_from=datetime(2026, 10, 1, tzinfo=UTC),
    )

    after = seeded_catalog.execute(
        select(
            PlanEntitlement.id,
            PlanEntitlement.revision,
            PlanEntitlement.effective_from,
        ).order_by(PlanEntitlement.id)
    ).all()
    assert after == before


def test_seed_preserves_a_centrally_configured_numeric_quota(
    seeded_catalog: Session,
) -> None:
    result = seeded_catalog.connection().exec_driver_sql(
        "UPDATE plan_entitlements SET allowance_units = 7 "
        "WHERE feature_key = 'video_analysis'"
    )
    assert result.rowcount == 2
    seeded_catalog.expire_all()

    seed_plan_catalog(seeded_catalog)

    free = seeded_catalog.scalar(
        select(SubscriptionPlan).where(SubscriptionPlan.code == PlanCode.FREE)
    )
    entitlement = seeded_catalog.scalar(
        select(PlanEntitlement).where(
            PlanEntitlement.plan_id == free.id,
            PlanEntitlement.feature_key == FeatureKey.VIDEO_ANALYSIS,
        )
    )
    assert entitlement.allowance_units == 7


def test_boolean_and_metered_entitlements_resolve_for_default_free_user(
    seeded_catalog: Session,
) -> None:
    user_id = uuid.uuid4()

    assert get_user_plan(seeded_catalog, user_id).code == PlanCode.FREE
    assert not is_feature_enabled(seeded_catalog, user_id, FeatureKey.LIVE_COACH)

    video = get_user_entitlement(
        seeded_catalog,
        user_id,
        FeatureKey.VIDEO_ANALYSIS,
    )
    assert video is not None
    assert video.entitlement_type is EntitlementType.METERED
    assert video.reset_policy == ResetPolicy.CALENDAR_MONTH_UTC
    assert video.allowance_units is None
    assert not video.is_limit_configured

    with pytest.raises(UnconfiguredAllowanceError):
        get_feature_allowance(seeded_catalog, user_id, FeatureKey.VIDEO_ANALYSIS)


def test_effective_plan_fails_closed_without_subscription(seeded_catalog: Session) -> None:
    assert resolve_effective_plan(seeded_catalog, uuid.uuid4()) is PlanCode.FREE


def test_effective_plan_resolves_verified_current_pro(seeded_catalog: Session) -> None:
    user_id = uuid.uuid4()
    attach_subscription(seeded_catalog, user_id=user_id, plan_code=PlanCode.PRO)
    assert resolve_effective_plan(
        seeded_catalog,
        user_id,
        as_of=datetime(2026, 9, 21, tzinfo=UTC),
    ) is PlanCode.PRO
    assert is_feature_enabled(seeded_catalog, user_id, FeatureKey.LIVE_COACH)


@pytest.mark.parametrize(
    "overrides",
    [
        {"end": datetime(2026, 9, 20, tzinfo=UTC), "period_end": datetime(2026, 9, 20, tzinfo=UTC)},
        {"provider_status": "past_due"},
        {"provider_status": "mystery"},
        {"provider_id": None},
        {"verified_at": None},
        {"start": None, "end": None},
        {"period_start": None, "period_end": None},
    ],
)
def test_invalid_or_inconsistent_pro_fails_closed(
    seeded_catalog: Session,
    overrides: dict,
) -> None:
    user_id = uuid.uuid4()
    attach_subscription(
        seeded_catalog,
        user_id=user_id,
        plan_code=PlanCode.PRO,
        **overrides,
    )

    assert resolve_effective_plan(
        seeded_catalog,
        user_id,
        as_of=datetime(2026, 9, 21, tzinfo=UTC),
    ) is PlanCode.FREE


def test_free_subscription_resolves_free(seeded_catalog: Session) -> None:
    user_id = uuid.uuid4()
    attach_subscription(seeded_catalog, user_id=user_id, plan_code=PlanCode.FREE)
    assert resolve_effective_plan(seeded_catalog, user_id) is PlanCode.FREE


def test_entitlements_ignore_a_forged_plan_claim(seeded_catalog: Session) -> None:
    # A caller-supplied JWT claim is deliberately not an input to entitlement
    # resolution; the database has no verified paid subscription.
    forged_claims = {"effective_plan": "pro"}
    assert forged_claims["effective_plan"] == "pro"
    assert is_feature_enabled(seeded_catalog, uuid.uuid4(), FeatureKey.LIVE_COACH) is False


def test_limited_and_unlimited_representations_are_unambiguous() -> None:
    limited = EntitlementDefinition.metered(
        FeatureKey.VIDEO_ANALYSIS,
        allowance_units=12,
    )
    unlimited = EntitlementDefinition.unlimited(FeatureKey.VIDEO_ANALYSIS)

    assert limited.entitlement_type is EntitlementType.METERED
    assert limited.allowance_units == 12
    assert limited.reset_policy is ResetPolicy.CALENDAR_MONTH_UTC
    assert unlimited.entitlement_type is EntitlementType.UNLIMITED
    assert unlimited.allowance_units is None
    assert unlimited.reset_policy is None


def test_duplicate_plan_feature_rows_are_prevented(seeded_catalog: Session) -> None:
    free = seeded_catalog.scalar(
        select(SubscriptionPlan).where(SubscriptionPlan.code == PlanCode.FREE)
    )
    assert free is not None

    duplicate = PlanEntitlement(
        plan_id=free.id,
        feature_key=FeatureKey.LIVE_COACH,
        entitlement_type=EntitlementType.BOOLEAN,
        enabled=False,
        allowance_units=None,
        reset_policy=None,
        revision=1,
        effective_from=datetime.now(UTC),
    )
    with pytest.raises(IntegrityError), seeded_catalog.begin_nested():
        seeded_catalog.add(duplicate)
        seeded_catalog.flush()


def test_safety_is_not_an_entitlement_and_remains_global(
    seeded_catalog: Session,
) -> None:
    entitlement_keys = {
        key
        for (key,) in seeded_catalog.execute(
            select(PlanEntitlement.feature_key).distinct()
        )
    }
    forbidden_terms = {
        "safety",
        "risk",
        "readiness",
        "prerequisite",
        "caution",
        "stop_condition",
        "disclaimer",
    }

    assert GLOBAL_SAFETY_GUIDANCE
    assert all(term not in key for key in entitlement_keys for term in forbidden_terms)
    assert {plan.code for plan in PLAN_CATALOG} == {PlanCode.FREE, PlanCode.PRO}


def test_each_plan_feature_pair_is_unique(seeded_catalog: Session) -> None:
    duplicates = seeded_catalog.execute(
        select(
            PlanEntitlement.plan_id,
            PlanEntitlement.feature_key,
            func.count(),
        )
        .group_by(PlanEntitlement.plan_id, PlanEntitlement.feature_key)
        .having(func.count() > 1)
    ).all()
    assert duplicates == []
