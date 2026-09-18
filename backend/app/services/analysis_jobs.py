from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import timedelta

from sqlalchemy import and_, case, func, or_, select, update
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.analysis import Analysis


class AnalysisClaimLostError(Exception):
    pass


@dataclass(frozen=True)
class AnalysisClaim:
    analysis_id: uuid.UUID
    claim_token: str
    attempt: int
    video_path: str


def claim_next_analysis(
    db: Session,
) -> AnalysisClaim | None:
    analysis = db.scalar(
        select(Analysis)
        .where(
            Analysis.video_path.is_not(None),
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
    analysis.stage = "running"
    analysis.claim_token = claim_token
    analysis.lease_expires_at = now + timedelta(
        seconds=settings.analysis_worker_lease_seconds
    )

    analysis.attempts += 1
    analysis.error_code = None
    analysis.progress_snapshot = {}

    db.commit()

    return AnalysisClaim(
        analysis_id=analysis.id,
        claim_token=claim_token,
        attempt=analysis.attempts,
        video_path=analysis.video_path,
    )


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
            analyzer_version=analyzer_version,
            model_version=model_version,
            error_code=None,
            claim_token=None,
            lease_expires_at=None,
        )
    )

    if result.rowcount != 1:
        db.rollback()
        raise AnalysisClaimLostError

    db.commit()


def fail_analysis(
    db: Session,
    claim: AnalysisClaim,
    *,
    error_code: str,
) -> None:
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
            claim_token=None,
            lease_expires_at=None,
        )
    )

    if result.rowcount != 1:
        db.rollback()
        raise AnalysisClaimLostError

    db.commit()
