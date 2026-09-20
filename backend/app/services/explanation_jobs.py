from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import timedelta

from sqlalchemy import and_, case, func, or_, select, update
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.analysis import Analysis
from app.services.analysis_events import record_analysis_event


class ExplanationClaimLostError(Exception):
    pass


class ExplanationRetryUnavailableError(Exception):
    pass


MAX_EXPLANATION_ATTEMPTS = 3


@dataclass(frozen=True)
class ExplanationClaim:
    analysis_id: uuid.UUID
    claim_token: str
    attempt: int


def claim_next_explanation(db: Session) -> ExplanationClaim | None:
    exhausted = db.scalar(
        select(Analysis)
        .where(
            Analysis.status == "completed",
            or_(Analysis.owner_kind != "guest", Analysis.access_expires_at > func.now()),
            Analysis.ai_feedback_status == "running",
            Analysis.ai_feedback_lease_expires_at <= func.now(),
            Analysis.ai_feedback_attempts >= MAX_EXPLANATION_ATTEMPTS,
        )
        .order_by(Analysis.created_at)
        .with_for_update(skip_locked=True)
        .limit(1)
    )
    if exhausted is not None:
        exhausted.ai_feedback_status = "failed"
        exhausted.ai_explanation = None
        exhausted.ai_feedback_claim_token = None
        exhausted.ai_feedback_lease_expires_at = None
        record_analysis_event(
            db,
            analysis_id=exhausted.id,
            attempt=exhausted.ai_feedback_attempts,
            event_type="explanation_failed",
        )
        db.commit()
        return None

    analysis = db.scalar(
        select(Analysis)
        .where(
            Analysis.status == "completed",
            or_(Analysis.owner_kind != "guest", Analysis.access_expires_at > func.now()),
            Analysis.result.is_not(None),
            Analysis.ai_feedback_attempts < MAX_EXPLANATION_ATTEMPTS,
            or_(
                Analysis.ai_feedback_status == "pending",
                and_(
                    Analysis.ai_feedback_status == "running",
                    Analysis.ai_feedback_lease_expires_at <= func.now(),
                ),
            ),
        )
        .order_by(
            case((Analysis.ai_feedback_status == "pending", 0), else_=1),
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
    analysis.ai_feedback_status = "running"
    analysis.ai_feedback_claim_token = uuid.uuid4().hex
    analysis.ai_feedback_lease_expires_at = now + timedelta(
        seconds=settings.analysis_worker_lease_seconds
    )
    analysis.ai_feedback_attempts += 1
    record_analysis_event(
        db,
        analysis_id=analysis.id,
        attempt=analysis.ai_feedback_attempts,
        event_type="explanation_started",
    )
    db.commit()
    return ExplanationClaim(
        analysis_id=analysis.id,
        claim_token=analysis.ai_feedback_claim_token,
        attempt=analysis.ai_feedback_attempts,
    )


def retry_failed_explanation(db: Session, analysis_id: uuid.UUID) -> str:
    analysis = db.scalar(
        select(Analysis)
        .where(Analysis.id == analysis_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if analysis is None or analysis.status != "completed" or analysis.result is None:
        db.rollback()
        raise ExplanationRetryUnavailableError("Analysis is not completed.")
    if analysis.ai_feedback_status in {"pending", "running"}:
        current_status = analysis.ai_feedback_status
        db.rollback()
        return current_status
    if analysis.ai_feedback_status != "failed":
        db.rollback()
        raise ExplanationRetryUnavailableError("Explanation is not failed.")
    if analysis.ai_feedback_attempts >= MAX_EXPLANATION_ATTEMPTS:
        db.rollback()
        raise ExplanationRetryUnavailableError("Explanation retry limit reached.")

    analysis.ai_feedback_status = "pending"
    analysis.ai_explanation = None
    analysis.ai_feedback_claim_token = None
    analysis.ai_feedback_lease_expires_at = None
    db.commit()
    return "pending"


def complete_explanation(db: Session, claim: ExplanationClaim, content: dict) -> None:
    result = db.execute(
        update(Analysis)
        .where(
            Analysis.id == claim.analysis_id,
            Analysis.status == "completed",
            Analysis.ai_feedback_status == "running",
            Analysis.ai_feedback_claim_token == claim.claim_token,
            Analysis.ai_feedback_attempts == claim.attempt,
            Analysis.ai_feedback_lease_expires_at > func.now(),
        )
        .values(
            ai_feedback_status="completed",
            ai_explanation=content,
            ai_feedback_claim_token=None,
            ai_feedback_lease_expires_at=None,
        )
    )
    if result.rowcount != 1:
        db.rollback()
        raise ExplanationClaimLostError
    record_analysis_event(
        db,
        analysis_id=claim.analysis_id,
        attempt=claim.attempt,
        event_type="explanation_ready",
    )
    db.commit()


def fail_explanation(db: Session, claim: ExplanationClaim) -> None:
    result = db.execute(
        update(Analysis)
        .where(
            Analysis.id == claim.analysis_id,
            Analysis.status == "completed",
            Analysis.ai_feedback_status == "running",
            Analysis.ai_feedback_claim_token == claim.claim_token,
            Analysis.ai_feedback_attempts == claim.attempt,
            Analysis.ai_feedback_lease_expires_at > func.now(),
        )
        .values(
            ai_feedback_status="failed",
            ai_explanation=None,
            ai_feedback_claim_token=None,
            ai_feedback_lease_expires_at=None,
        )
    )
    if result.rowcount != 1:
        db.rollback()
        raise ExplanationClaimLostError
    record_analysis_event(
        db,
        analysis_id=claim.analysis_id,
        attempt=claim.attempt,
        event_type="explanation_failed",
    )
    db.commit()
