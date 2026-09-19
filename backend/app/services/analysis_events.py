from __future__ import annotations

import uuid

from sqlalchemy import func, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.models.analysis import Analysis
from app.models.analysis_event import AnalysisEvent
from app.services.analysis_jobs import AnalysisClaim, AnalysisClaimLostError

PRODUCT_EVENTS = frozenset(
    {
        "analysis_queued",
        "processing_started",
        "video_loaded",
        "movement_analysis_started",
        "rep_completed",
        "finalizing",
        "completed",
        "failed",
    }
)
INTERMEDIATE_EVENTS = frozenset(
    {"video_loaded", "movement_analysis_started", "rep_completed", "finalizing"}
)


def record_analysis_event(
    db: Session,
    *,
    analysis_id: uuid.UUID,
    attempt: int,
    event_type: str,
    rep_index: int | None = None,
    outcome: str | None = None,
) -> None:
    if event_type not in PRODUCT_EVENTS:
        raise ValueError("Unknown analysis progress event.")

    payload: dict[str, str | int] = {"attempt": attempt}
    event_key = f"{attempt}:{event_type}"
    if event_type == "rep_completed":
        if rep_index is None or rep_index < 1 or outcome not in {
            "valid", "partial", "uncertain"
        }:
            raise ValueError("Invalid completed rep progress.")
        payload.update(rep_index=rep_index, outcome=outcome)
        event_key += f":{rep_index}"
    elif rep_index is not None or outcome is not None:
        raise ValueError("Unexpected rep progress data.")

    db.execute(
        insert(AnalysisEvent)
        .values(
            analysis_id=analysis_id,
            attempt=attempt,
            event_key=event_key,
            event_type=event_type,
            payload=payload,
        )
        .on_conflict_do_nothing(constraint="uq_analysis_events_key")
    )


def publish_claim_event(
    db: Session,
    claim: AnalysisClaim,
    event_type: str,
    *,
    rep_index: int | None = None,
    outcome: str | None = None,
) -> None:
    if event_type not in INTERMEDIATE_EVENTS:
        raise ValueError("Only intermediate progress can be published here.")

    # The conditional update locks the analysis row. The event and stage then
    # commit together, and an expired/reclaimed worker cannot publish progress.
    values = {"stage": event_type} if event_type != "rep_completed" else {"stage": Analysis.stage}
    result = db.execute(
        update(Analysis)
        .where(
            Analysis.id == claim.analysis_id,
            Analysis.status == "running",
            Analysis.claim_token == claim.claim_token,
            Analysis.attempts == claim.attempt,
            Analysis.lease_expires_at > func.now(),
        )
        .values(**values)
    )
    if result.rowcount != 1:
        db.rollback()
        raise AnalysisClaimLostError

    record_analysis_event(
        db,
        analysis_id=claim.analysis_id,
        attempt=claim.attempt,
        event_type=event_type,
        rep_index=rep_index,
        outcome=outcome,
    )
    db.commit()
