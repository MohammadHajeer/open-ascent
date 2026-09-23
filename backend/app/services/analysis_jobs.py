from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import timedelta

from sqlalchemy import and_, case, func, or_, select, update
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.analysis import Analysis
from app.services.feature_usage import consume_usage, release_usage


class AnalysisClaimLostError(Exception):
    pass


class AnalysisRetryUnavailableError(Exception):
    pass


MAX_ANALYSIS_ATTEMPTS = 3


@dataclass(frozen=True)
class AnalysisClaim:
    analysis_id: uuid.UUID
    claim_token: str
    attempt: int
    video_path: str


def claim_next_analysis(
    db: Session,
) -> AnalysisClaim | None:
    from app.services.analysis_events import record_analysis_event

    exhausted = db.scalar(
        select(Analysis)
        .where(
            Analysis.status.in_(["queued", "running"]),
            Analysis.attempts >= MAX_ANALYSIS_ATTEMPTS,
            or_(Analysis.status == "queued", Analysis.lease_expires_at <= func.now()),
        )
        .order_by(Analysis.created_at)
        .with_for_update(skip_locked=True)
        .limit(1)
    )
    if exhausted is not None:
        exhausted.status = "failed"
        exhausted.stage = "failed"
        exhausted.error_code = "attempts_exhausted"
        exhausted.failed_at = db.scalar(select(func.now()))
        exhausted.claim_token = None
        exhausted.lease_expires_at = None
        if exhausted.owner_kind == "authenticated":
            exhausted.video_delete_after = exhausted.failed_at
        if exhausted.feature_usage_id is not None:
            release_usage(
                db,
                exhausted.feature_usage_id,
                reason="analysis_failed:attempts_exhausted",
            )
        record_analysis_event(
            db,
            analysis_id=exhausted.id,
            attempt=exhausted.attempts,
            event_type="failed",
        )
        db.commit()
        return None

    analysis = db.scalar(
        select(Analysis)
        .where(
            Analysis.video_path.is_not(None),
            Analysis.attempts < MAX_ANALYSIS_ATTEMPTS,
            or_(
                Analysis.owner_kind != "guest", Analysis.access_expires_at > func.now()
            ),
            or_(
                Analysis.status == "queued",
                and_(
                    Analysis.status == "running",
                    Analysis.lease_expires_at <= func.now(),
                ),
            ),
        )
        .order_by(
            case(
                (Analysis.status == "queued", 0),
                else_=1,
            ),
            Analysis.created_at,
        )
        .with_for_update(skip_locked=True)
        .limit(1)
    )

    if analysis is None:
        db.rollback()
        return None

    now = db.scalar(select(func.now()))

    if now is None:
        raise RuntimeError("Could not determine database time.")

    claim_token = uuid.uuid4().hex

    analysis.status = "running"
    analysis.stage = "processing_started"
    analysis.claim_token = claim_token
    analysis.lease_expires_at = now + timedelta(
        seconds=settings.analysis_worker_lease_seconds
    )

    analysis.attempts += 1
    analysis.error_code = None
    analysis.progress_snapshot = {}

    record_analysis_event(
        db,
        analysis_id=analysis.id,
        attempt=analysis.attempts,
        event_type="processing_started",
    )

    db.commit()

    return AnalysisClaim(
        analysis_id=analysis.id,
        claim_token=claim_token,
        attempt=analysis.attempts,
        video_path=analysis.video_path,
    )


def retry_failed_analysis(db: Session, analysis_id: uuid.UUID) -> None:
    """Manual guest retry only; authenticated usage and media may be released."""
    analysis = db.scalar(
        select(Analysis)
        .where(Analysis.id == analysis_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if (
        analysis is None
        or analysis.status != "failed"
        or analysis.owner_kind != "guest"
        or analysis.feature_usage_id is not None
        or analysis.video_path is None
        or analysis.guest_cleaned_at is not None
        or analysis.access_expires_at is None
        or analysis.access_expires_at <= db.scalar(select(func.now()))
        or analysis.attempts >= MAX_ANALYSIS_ATTEMPTS
    ):
        db.rollback()
        raise AnalysisRetryUnavailableError("This analysis cannot be retried safely.")
    analysis.status = "queued"
    analysis.stage = "queued"
    analysis.error_code = None
    analysis.failed_at = None
    analysis.claim_token = None
    analysis.lease_expires_at = None
    analysis.progress_snapshot = {}
    db.commit()


def renew_analysis_lease(
    db: Session,
    claim: AnalysisClaim,
) -> None:
    now = db.scalar(select(func.now()))

    if now is None:
        raise RuntimeError("Could not determine database time.")

    result = db.execute(
        update(Analysis)
        .where(
            Analysis.id == claim.analysis_id,
            Analysis.status == "running",
            Analysis.claim_token == claim.claim_token,
            Analysis.lease_expires_at > now,
        )
        .values(
            lease_expires_at=(
                now + timedelta(seconds=(settings.analysis_worker_lease_seconds))
            )
        )
    )

    if result.rowcount != 1:
        db.rollback()
        raise AnalysisClaimLostError

    db.commit()


def complete_analysis(
    db: Session,
    claim: AnalysisClaim,
    *,
    result_data: dict,
    analyzer_version: str,
    model_version: str,
) -> None:
    from app.services.analysis_events import record_analysis_event

    outcome = result_data.get("outcome")
    if outcome not in {"completed", "zero_valid_reps", "insufficient_evidence"}:
        outcome = None

    def count(name: str) -> int | None:
        value = result_data.get(name)
        return value if type(value) is int and value >= 0 else None

    result = db.execute(
        update(Analysis)
        .where(
            Analysis.id == claim.analysis_id,
            Analysis.status == "running",
            Analysis.claim_token == claim.claim_token,
            Analysis.lease_expires_at > func.now(),
        )
        .values(
            status="completed",
            stage="completed",
            result=result_data,
            terminal_outcome=outcome,
            valid_rep_count=count("valid_rep_count"),
            partial_rep_count=count("partial_rep_count"),
            uncertain_rep_count=count("uncertain_rep_count"),
            completed_at=func.now(),
            video_delete_after=case(
                (Analysis.owner_kind == "authenticated", func.now()),
                else_=Analysis.video_delete_after,
            ),
            analyzer_version=analyzer_version,
            model_version=model_version,
            error_code=None,
            claim_token=None,
            lease_expires_at=None,
        )
        .returning(Analysis.feature_usage_id)
    )

    updated = result.one_or_none()
    if updated is None:
        db.rollback()
        raise AnalysisClaimLostError

    if updated.feature_usage_id is not None:
        consume_usage(db, updated.feature_usage_id)

    record_analysis_event(
        db,
        analysis_id=claim.analysis_id,
        attempt=claim.attempt,
        event_type="completed",
    )
    db.commit()


def fail_analysis(
    db: Session,
    claim: AnalysisClaim,
    *,
    error_code: str,
) -> None:
    from app.services.analysis_events import record_analysis_event

    result = db.execute(
        update(Analysis)
        .where(
            Analysis.id == claim.analysis_id,
            Analysis.status == "running",
            Analysis.claim_token == claim.claim_token,
            Analysis.lease_expires_at > func.now(),
        )
        .values(
            status="failed",
            stage="failed",
            error_code=error_code,
            failed_at=func.now(),
            video_delete_after=case(
                (Analysis.owner_kind == "authenticated", func.now()),
                else_=Analysis.video_delete_after,
            ),
            claim_token=None,
            lease_expires_at=None,
        )
        .returning(Analysis.feature_usage_id)
    )

    updated = result.one_or_none()
    if updated is None:
        db.rollback()
        raise AnalysisClaimLostError

    if updated.feature_usage_id is not None:
        release_usage(
            db,
            updated.feature_usage_id,
            reason=f"analysis_failed:{error_code}",
        )

    record_analysis_event(
        db,
        analysis_id=claim.analysis_id,
        attempt=claim.attempt,
        event_type="failed",
    )
    db.commit()
