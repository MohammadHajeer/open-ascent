from __future__ import annotations

import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from threading import Barrier

import pytest
from sqlalchemy import delete, select, text
from sqlalchemy.orm import Session

from app.db.database import SessionLocal
from app.models.enums import EntitlementType, FeatureKey, FeatureUsageStatus
from app.models.profile import Profile
from app.models.subscription import FeatureUsage, PlanEntitlement, SubscriptionPlan
from app.services.entitlements import UnconfiguredAllowanceError
from app.services.feature_usage import (
    FeatureAccessDeniedError,
    InvalidUsageTransitionError,
    QuotaExceededError,
    UsageIdempotencyConflictError,
    UsageRecordNotFoundError,
    calendar_month_window,
    consume_usage,
    release_usage,
    reserve_usage,
)


def _create_user(db: Session, *, label: str = "usage ledger") -> uuid.UUID:
    user_id = uuid.uuid4()
    db.execute(text("INSERT INTO auth.users (id) VALUES (:id)"), {"id": user_id})
    db.add(Profile(id=user_id, display_name=label, app_role="athlete"))
    db.flush()
    return user_id


def _free_entitlement(db: Session, feature_key: FeatureKey) -> PlanEntitlement:
    entitlement = db.scalar(
        select(PlanEntitlement)
        .join(SubscriptionPlan, SubscriptionPlan.id == PlanEntitlement.plan_id)
        .where(
            SubscriptionPlan.code == "free",
            PlanEntitlement.feature_key == feature_key.value,
        )
    )
    assert entitlement is not None
    return entitlement


def _metered(db: Session, *, allowance: int | None) -> PlanEntitlement:
    entitlement = _free_entitlement(db, FeatureKey.VIDEO_ANALYSIS)
    entitlement.entitlement_type = EntitlementType.METERED.value
    entitlement.enabled = True
    entitlement.allowance_units = allowance
    entitlement.reset_policy = "calendar_month_utc"
    db.flush()
    return entitlement


def _reserve(
    db: Session,
    *,
    user_id: uuid.UUID,
    operation_key: str,
    fingerprint: str | None = None,
    at: datetime | None = None,
) -> FeatureUsage | None:
    evaluated_at = at or datetime.now(UTC)
    return reserve_usage(
        db,
        user_id=user_id,
        feature_key=FeatureKey.VIDEO_ANALYSIS,
        operation_key=operation_key,
        request_fingerprint=fingerprint or f"fingerprint:{operation_key}",
        reservation_expires_at=evaluated_at + timedelta(days=2),
        as_of=evaluated_at,
    )


def test_reserve_settle_idempotency_and_quota_counting(db: Session) -> None:
    user_id = _create_user(db)
    _metered(db, allowance=2)

    first = _reserve(db, user_id=user_id, operation_key="first")
    assert first is not None
    assert first.status == FeatureUsageStatus.RESERVED.value
    assert _reserve(db, user_id=user_id, operation_key="first") is first

    with pytest.raises(UsageIdempotencyConflictError):
        _reserve(
            db,
            user_id=user_id,
            operation_key="first",
            fingerprint="different-work",
        )

    second = _reserve(db, user_id=user_id, operation_key="second")
    assert second is not None
    with pytest.raises(QuotaExceededError):
        _reserve(db, user_id=user_id, operation_key="reserved-counts")

    consumed = consume_usage(db, second.id, user_id=user_id)
    assert consumed.status == FeatureUsageStatus.CONSUMED.value
    settled_at = consumed.settled_at
    assert consume_usage(db, second.id, user_id=user_id).settled_at == settled_at
    with pytest.raises(QuotaExceededError):
        _reserve(db, user_id=user_id, operation_key="consumed-counts")

    released = release_usage(db, first.id, user_id=user_id, reason="work_abandoned")
    assert released.status == FeatureUsageStatus.RELEASED.value
    assert (
        release_usage(
            db, first.id, user_id=user_id, reason="duplicate_retry"
        ).release_reason
        == "work_abandoned"
    )

    replacement = _reserve(db, user_id=user_id, operation_key="replacement")
    assert replacement is not None
    with pytest.raises(InvalidUsageTransitionError):
        release_usage(db, second.id, reason="content_deleted")
    with pytest.raises(InvalidUsageTransitionError):
        consume_usage(db, first.id)


def test_entitlement_semantics_fail_closed(db: Session) -> None:
    user_id = _create_user(db)
    entitlement = _metered(db, allowance=None)
    with pytest.raises(UnconfiguredAllowanceError):
        _reserve(db, user_id=user_id, operation_key="pending-limit")

    entitlement.entitlement_type = EntitlementType.BOOLEAN.value
    entitlement.enabled = False
    entitlement.allowance_units = None
    entitlement.reset_policy = None
    db.flush()
    with pytest.raises(FeatureAccessDeniedError):
        _reserve(db, user_id=user_id, operation_key="disabled")

    entitlement.entitlement_type = EntitlementType.UNLIMITED.value
    entitlement.enabled = True
    db.flush()
    assert _reserve(db, user_id=user_id, operation_key="unlimited") is None
    assert (
        db.scalar(select(FeatureUsage).where(FeatureUsage.user_id == user_id)) is None
    )


def test_plan_generation_one_operation_uses_one_unit(
    db: Session,
) -> None:
    user_id = _create_user(db, label="plan quota")
    entitlement = _free_entitlement(db, FeatureKey.TRAINING_PLAN_GENERATION)
    assert entitlement.allowance_units == 1
    at = datetime.now(UTC)

    def reserve(operation: str) -> FeatureUsage | None:
        return reserve_usage(
            db,
            user_id=user_id,
            feature_key=FeatureKey.TRAINING_PLAN_GENERATION,
            operation_key=operation,
            request_fingerprint=f"plan:{operation}",
            reservation_expires_at=at + timedelta(minutes=15),
            as_of=at,
        )

    generation = reserve("request-one")
    assert generation is not None
    assert reserve("request-one").id == generation.id
    consume_usage(db, generation.id, user_id=user_id)
    assert generation.units == 1
    assert generation.status == FeatureUsageStatus.CONSUMED.value
    with pytest.raises(QuotaExceededError):
        reserve("request-two")
    assert len(list(db.scalars(
        select(FeatureUsage).where(
            FeatureUsage.user_id == user_id,
            FeatureUsage.feature_key == FeatureKey.TRAINING_PLAN_GENERATION,
        )
    ))) == 1


def test_user_isolation_and_period_windows(db: Session) -> None:
    user_a = _create_user(db, label="user A")
    user_b = _create_user(db, label="user B")
    _metered(db, allowance=1)
    september = datetime(2026, 9, 30, 23, 59, tzinfo=UTC)
    october = datetime(2026, 10, 1, 0, 0, tzinfo=UTC)

    usage_a = _reserve(db, user_id=user_a, operation_key="a-september", at=september)
    usage_b = _reserve(db, user_id=user_b, operation_key="b-september", at=september)
    usage_october = _reserve(db, user_id=user_a, operation_key="a-october", at=october)
    assert usage_a is not None and usage_b is not None and usage_october is not None
    assert (usage_a.window_start, usage_a.window_end) == calendar_month_window(
        september
    )
    assert (usage_october.window_start, usage_october.window_end) == (
        datetime(2026, 10, 1, tzinfo=UTC),
        datetime(2026, 11, 1, tzinfo=UTC),
    )
    with pytest.raises(UsageRecordNotFoundError):
        consume_usage(db, usage_a.id, user_id=user_b)


def test_concurrent_final_slot_admits_only_one_real_postgres_transaction() -> None:
    user_id = uuid.uuid4()
    original: tuple[str, bool, int | None, str | None] | None = None
    try:
        with SessionLocal() as setup:
            setup.execute(
                text("INSERT INTO auth.users (id) VALUES (:id)"), {"id": user_id}
            )
            setup.add(Profile(id=user_id, display_name="concurrent quota test"))
            setup.flush()
            entitlement = _free_entitlement(setup, FeatureKey.VIDEO_ANALYSIS)
            original = (
                entitlement.entitlement_type,
                entitlement.enabled,
                entitlement.allowance_units,
                entitlement.reset_policy,
            )
            entitlement.entitlement_type = EntitlementType.METERED.value
            entitlement.enabled = True
            entitlement.allowance_units = 1
            entitlement.reset_policy = "calendar_month_utc"
            setup.commit()

        barrier = Barrier(2)

        def attempt(operation_key: str) -> str:
            with SessionLocal() as session:
                barrier.wait(timeout=10)
                try:
                    usage = _reserve(
                        session, user_id=user_id, operation_key=operation_key
                    )
                    assert usage is not None
                    session.commit()
                    return "admitted"
                except QuotaExceededError:
                    session.rollback()
                    return "denied"

        with ThreadPoolExecutor(max_workers=2) as executor:
            outcomes = list(executor.map(attempt, ("concurrent-a", "concurrent-b")))
        assert sorted(outcomes) == ["admitted", "denied"]

        with SessionLocal() as verify:
            usages = list(
                verify.scalars(
                    select(FeatureUsage).where(FeatureUsage.user_id == user_id)
                )
            )
            assert len(usages) == 1
            assert usages[0].status == FeatureUsageStatus.RESERVED.value
    finally:
        with SessionLocal() as cleanup:
            cleanup.execute(delete(FeatureUsage).where(FeatureUsage.user_id == user_id))
            cleanup.execute(
                text("DELETE FROM profiles WHERE id = :id"), {"id": user_id}
            )
            cleanup.execute(
                text("DELETE FROM auth.users WHERE id = :id"), {"id": user_id}
            )
            if original is not None:
                entitlement = _free_entitlement(cleanup, FeatureKey.VIDEO_ANALYSIS)
                (
                    entitlement.entitlement_type,
                    entitlement.enabled,
                    entitlement.allowance_units,
                    entitlement.reset_policy,
                ) = original
            cleanup.commit()
