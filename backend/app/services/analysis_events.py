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
        "explanation_started",
        "explanation_ready",
        "explanation_failed",
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
    variations: dict[str, str] | None = None,
    target_match: bool | None = None,
    target_deviations: list[dict[str, str]] | None = None,
) -> None:
    if event_type not in PRODUCT_EVENTS:
        raise ValueError("Unknown analysis progress event.")

    payload: dict = {"attempt": attempt}
    event_key = f"{attempt}:{event_type}"
    if event_type == "rep_completed":
        if (
            rep_index is None
            or rep_index < 1
            or outcome not in {"valid", "partial", "uncertain"}
        ):
            raise ValueError("Invalid completed rep progress.")
        payload.update(rep_index=rep_index, outcome=outcome)
        if variations is not None:
            allowed = {
                "base_movement": {"pull_up", "chin_up", "uncertain"},
                "grip_width": {"close", "standard", "wide", "uncertain"},
                "pull_height": {"standard", "high", "uncertain"},
            }
            payload["classification"] = {
                key: variations.get(key, "uncertain")
                if variations.get(key) in values
                else "uncertain"
                for key, values in allowed.items()
            }
            payload["target_match"] = target_match
            payload["target_deviations"] = [
                item
                for item in (target_deviations or [])
                if item.get("dimension") in allowed
                and item.get("expected") in allowed[item["dimension"]]
                and item.get("detected") in allowed[item["dimension"]]
            ]
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
    variations: dict[str, str] | None = None,
    target_match: bool | None = None,
    target_deviations: list[dict[str, str]] | None = None,
) -> None:
    if event_type not in INTERMEDIATE_EVENTS:
        raise ValueError("Only intermediate progress can be published here.")

    # The conditional update locks the analysis row. The event and stage then
    # commit together, and an expired/reclaimed worker cannot publish progress.
    values = (
        {"stage": event_type}
        if event_type != "rep_completed"
        else {"stage": Analysis.stage}
    )
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
        variations=variations,
        target_match=target_match,
        target_deviations=target_deviations,
    )
    db.commit()
