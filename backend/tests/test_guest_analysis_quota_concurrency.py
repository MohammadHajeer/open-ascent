from __future__ import annotations

import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from threading import Barrier

import pytest
from sqlalchemy import delete, func, select

from app.core.config import settings
from app.core.safety import CURRENT_SAFETY_ACK_VERSION
from app.db.database import SessionLocal
from app.models.analysis import Analysis
from app.models.guest_analysis_usage import GuestAnalysisUsage
from app.models.movement import Movement
from app.models.movement_documentation import MovementDocumentation
from app.schemas.analysis import GuestAnalysisReservationRequest
from app.services import analysis as analysis_service
from app.services.analysis import (
    GuestGlobalDailyLimitExceededError,
    reserve_guest_analysis,
)


def test_concurrent_requests_cannot_both_take_the_final_global_slot(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    quota_time = datetime(2097, 3, 4, 12, tzinfo=UTC)
    monkeypatch.setattr(analysis_service, "_utc_now", lambda: quota_time)
    monkeypatch.setattr(settings, "guest_global_daily_limit", 1)
    monkeypatch.setattr(settings, "guest_reservations_per_window", 100)

    setup = SessionLocal()
    unique = uuid.uuid4().hex[:8]
    movement = Movement(
        slug=f"quota-concurrency-{unique}",
        name=f"Quota Concurrency {unique}",
        family_key="quota-concurrency",
        upload_analysis_supported=True,
        live_coach_supported=False,
    )
    setup.add(movement)
    setup.flush()
    documentation = MovementDocumentation(
        movement_id=movement.id,
        version=1,
        status="published",
        content={"notice": "Concurrency test guidance."},
        published_at=quota_time,
    )
    setup.add(documentation)
    setup.commit()
    movement_id = movement.id
    documentation_id = documentation.id
    setup.close()

    payload = GuestAnalysisReservationRequest(
        movement_id=movement_id,
        safety_documentation_id=documentation_id,
        safety_ack_version=CURRENT_SAFETY_ACK_VERSION,
    )
    barrier = Barrier(2)

    def reserve(index: int) -> str:
        session = SessionLocal()
        try:
            barrier.wait()
            reserve_guest_analysis(
                session,
                payload,
                operation_key=str(uuid.uuid4()),
                guest_rate_key=f"{index + 1:064x}",
            )
            return "accepted"
        except GuestGlobalDailyLimitExceededError:
            return "capacity"
        finally:
            session.close()

    try:
        with ThreadPoolExecutor(max_workers=2) as executor:
            outcomes = list(executor.map(reserve, range(2)))

        assert sorted(outcomes) == ["accepted", "capacity"]
        verification = SessionLocal()
        try:
            admitted = verification.scalar(
                select(func.count(GuestAnalysisUsage.id)).where(
                    GuestAnalysisUsage.usage_date == quota_time.date()
                )
            )
            assert admitted == 1
        finally:
            verification.close()
    finally:
        cleanup = SessionLocal()
        cleanup.execute(delete(Analysis).where(Analysis.movement_id == movement_id))
        cleanup.execute(
            delete(MovementDocumentation).where(
                MovementDocumentation.id == documentation_id
            )
        )
        cleanup.execute(delete(Movement).where(Movement.id == movement_id))
        cleanup.commit()
        cleanup.close()
