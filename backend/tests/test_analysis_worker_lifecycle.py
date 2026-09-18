from __future__ import annotations

import uuid
from collections.abc import Generator
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import delete, update
from sqlalchemy.orm import Session

from app.models.analysis import Analysis
from app.models.movement import Movement
from app.models.movement_documentation import MovementDocumentation
from app.services.analysis_jobs import (
    AnalysisClaim,
    AnalysisClaimLostError,
    claim_next_analysis,
    complete_analysis,
    fail_analysis,
    renew_analysis_lease,
)
from app.workers import analysis_worker
from app.workers.analysis_worker import (
    AnalysisProcessingResult,
    process_one_analysis,
)


@pytest.fixture(autouse=True)
def isolate_worker_queue(
    db: Session,
) -> Generator[None, None, None]:
    db.execute(
        update(Analysis)
        .where(Analysis.status.in_(["queued", "running"]))
        .values(
            status="completed",
            stage="completed",
            claim_token=None,
            lease_expires_at=None,
        )
    )

    db.flush()

    yield


@pytest.fixture
def worker_test_data(
    db: Session,
) -> Generator[
    tuple[Movement, MovementDocumentation],
    None,
    None,
]:
    unique = uuid.uuid4().hex[:8]

    movement = Movement(
        slug=f"worker-test-{unique}",
        name=f"Worker Test {unique}",
        family_key="worker-test",
        upload_analysis_supported=True,
        live_coach_supported=False,
    )

    db.add(movement)
    db.flush()

    documentation = MovementDocumentation(
        movement_id=movement.id,
        version=1,
        status="published",
        content={
            "notice": "ANA-03 worker test documentation.",
        },
        published_at=datetime.now(UTC),
    )

    db.add(documentation)
    db.commit()

    db.refresh(movement)
    db.refresh(documentation)

    yield movement, documentation

    db.execute(delete(Analysis).where(Analysis.movement_id == movement.id))

    db.execute(
        delete(MovementDocumentation).where(
            MovementDocumentation.movement_id == movement.id
        )
    )

    db.execute(delete(Movement).where(Movement.id == movement.id))

    db.commit()


def create_queued_analysis(
    db: Session,
    movement: Movement,
    documentation: MovementDocumentation,
) -> Analysis:
    now = datetime.now(UTC)

    analysis = Analysis(
        movement_id=movement.id,
        safety_documentation_id=documentation.id,
        safety_ack_version="v1",
        safety_acknowledged_at=now,
        owner_kind="guest",
        status="queued",
        stage="queued",
        video_path=(f"analyses/{uuid.uuid4()}/source.mp4"),
        guest_token_hash="test-token-hash",
        guest_rate_key="test-rate-key",
        reservation_operation_key=str(uuid.uuid4()),
        request_fingerprint=uuid.uuid4().hex,
        reservation_expires_at=(now + timedelta(minutes=15)),
        access_expires_at=(now + timedelta(hours=1)),
        purge_after=(now + timedelta(hours=24)),
    )

    db.add(analysis)
    db.commit()
    db.refresh(analysis)

    return analysis


def test_queued_analysis_can_be_claimed(
    db: Session,
    worker_test_data: tuple[
        Movement,
        MovementDocumentation,
    ],
) -> None:
    movement, documentation = worker_test_data

    analysis = create_queued_analysis(
        db,
        movement,
        documentation,
    )

    claim = claim_next_analysis(db)

    assert claim is not None
    assert claim.analysis_id == analysis.id
    assert claim.video_path == analysis.video_path
    assert claim.attempt == 1
    assert claim.claim_token

    db.refresh(analysis)

    assert analysis.status == "running"
    assert analysis.stage == "running"
    assert analysis.attempts == 1
    assert analysis.claim_token == claim.claim_token
    assert analysis.lease_expires_at is not None


def test_active_running_analysis_is_not_claimed_again(
    db: Session,
    worker_test_data: tuple[
        Movement,
        MovementDocumentation,
    ],
) -> None:
    movement, documentation = worker_test_data

    create_queued_analysis(
        db,
        movement,
        documentation,
    )

    first_claim = claim_next_analysis(db)

    assert first_claim is not None

    second_claim = claim_next_analysis(db)

    assert second_claim is None


def test_stale_analysis_can_be_reclaimed(
    db: Session,
    worker_test_data: tuple[
        Movement,
        MovementDocumentation,
    ],
) -> None:
    movement, documentation = worker_test_data

    analysis = create_queued_analysis(
        db,
        movement,
        documentation,
    )

    old_token = "old-worker-token"

    analysis.status = "running"
    analysis.stage = "running"
    analysis.claim_token = old_token
    analysis.lease_expires_at = datetime.now(UTC) - timedelta(minutes=1)
    analysis.attempts = 1

    db.commit()

    claim = claim_next_analysis(db)

    assert claim is not None
    assert claim.analysis_id == analysis.id
    assert claim.claim_token != old_token
    assert claim.attempt == 2

    db.refresh(analysis)

    assert analysis.status == "running"
    assert analysis.attempts == 2
    assert analysis.claim_token == claim.claim_token


def test_old_claim_cannot_persist_result_after_reclaim(
    db: Session,
    worker_test_data: tuple[
        Movement,
        MovementDocumentation,
    ],
) -> None:
    movement, documentation = worker_test_data

    analysis = create_queued_analysis(
        db,
        movement,
        documentation,
    )

    old_token = "old-worker-token"

    analysis.status = "running"
    analysis.stage = "running"
    analysis.claim_token = old_token
    analysis.lease_expires_at = datetime.now(UTC) - timedelta(minutes=1)
    analysis.attempts = 1

    db.commit()

    old_claim = AnalysisClaim(
        analysis_id=analysis.id,
        claim_token=old_token,
        attempt=1,
        video_path=analysis.video_path,
    )

    new_claim = claim_next_analysis(db)

    assert new_claim is not None

    with pytest.raises(AnalysisClaimLostError):
        complete_analysis(
            db,
            old_claim,
            result_data={
                "source": "old-worker",
            },
            analyzer_version="test-v1",
            model_version="test-v1",
        )

    complete_analysis(
        db,
        new_claim,
        result_data={
            "source": "new-worker",
        },
        analyzer_version="test-v1",
        model_version="test-v1",
    )

    db.refresh(analysis)

    assert analysis.status == "completed"
    assert analysis.result == {
        "source": "new-worker",
    }


def test_current_claim_can_complete_analysis(
    db: Session,
    worker_test_data: tuple[
        Movement,
        MovementDocumentation,
    ],
) -> None:
    movement, documentation = worker_test_data

    analysis = create_queued_analysis(
        db,
        movement,
        documentation,
    )

    claim = claim_next_analysis(db)

    assert claim is not None

    complete_analysis(
        db,
        claim,
        result_data={
            "reps": 10,
        },
        analyzer_version="test-analyzer-v1",
        model_version="test-model-v1",
    )

    db.refresh(analysis)

    assert analysis.status == "completed"
    assert analysis.stage == "completed"
    assert analysis.result == {
        "reps": 10,
    }

    assert analysis.analyzer_version == "test-analyzer-v1"

    assert analysis.model_version == "test-model-v1"

    assert analysis.claim_token is None
    assert analysis.lease_expires_at is None


def test_current_claim_can_fail_analysis(
    db: Session,
    worker_test_data: tuple[
        Movement,
        MovementDocumentation,
    ],
) -> None:
    movement, documentation = worker_test_data

    analysis = create_queued_analysis(
        db,
        movement,
        documentation,
    )

    claim = claim_next_analysis(db)

    assert claim is not None

    fail_analysis(
        db,
        claim,
        error_code="processing_error",
    )

    db.refresh(analysis)

    assert analysis.status == "failed"
    assert analysis.stage == "failed"
    assert analysis.error_code == "processing_error"
    assert analysis.claim_token is None
    assert analysis.lease_expires_at is None


def test_current_worker_can_renew_lease(
    db: Session,
    worker_test_data: tuple[
        Movement,
        MovementDocumentation,
    ],
) -> None:
    movement, documentation = worker_test_data

    analysis = create_queued_analysis(
        db,
        movement,
        documentation,
    )

    claim = claim_next_analysis(db)

    assert claim is not None

    db.refresh(analysis)

    original_expiry = analysis.lease_expires_at

    assert original_expiry is not None

    renew_analysis_lease(
        db,
        claim,
    )

    db.refresh(analysis)

    assert analysis.lease_expires_at is not None
    assert analysis.lease_expires_at >= original_expiry


def test_processing_runs_without_open_db_session(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    active_sessions = 0
    created_sessions = 0

    class FakeSession:
        def __enter__(self):
            nonlocal active_sessions
            active_sessions += 1
            return self

        def __exit__(
            self,
            exc_type,
            exc_value,
            traceback,
        ):
            nonlocal active_sessions
            active_sessions -= 1

    def fake_session_local():
        nonlocal created_sessions
        created_sessions += 1
        return FakeSession()

    claim = AnalysisClaim(
        analysis_id=uuid.uuid4(),
        claim_token="current-token",
        attempt=1,
        video_path="analyses/test/source.mp4",
    )

    def fake_claim_next_analysis(db):
        assert active_sessions == 1
        return claim

    def fake_processor(
        received_claim: AnalysisClaim,
    ) -> AnalysisProcessingResult:
        # This is the important assertion:
        # video processing happens after the
        # claim DB session has been closed.
        assert active_sessions == 0
        assert received_claim == claim

        return AnalysisProcessingResult(
            result_data={
                "reps": 5,
            },
            analyzer_version="test-v1",
            model_version="test-v1",
        )

    def fake_complete_analysis(
        db,
        received_claim,
        *,
        result_data,
        analyzer_version,
        model_version,
    ):
        assert active_sessions == 1
        assert received_claim == claim
        assert result_data == {
            "reps": 5,
        }

    monkeypatch.setattr(
        analysis_worker,
        "SessionLocal",
        fake_session_local,
    )

    monkeypatch.setattr(
        analysis_worker,
        "claim_next_analysis",
        fake_claim_next_analysis,
    )

    monkeypatch.setattr(
        analysis_worker,
        "complete_analysis",
        fake_complete_analysis,
    )

    processed = process_one_analysis(fake_processor)

    assert processed is True

    # One short session for claiming,
    # another short session for completion.
    assert created_sessions == 2

    # Nothing remains open afterwards.
    assert active_sessions == 0
