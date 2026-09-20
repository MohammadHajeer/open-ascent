"""Remove expired guest data while retaining minimal anonymous statistics."""

from __future__ import annotations

import logging
from datetime import timedelta

from sqlalchemy import delete, func, null, or_, select
from sqlalchemy.orm import Session
from storage3.exceptions import StorageApiError

from app.core.config import settings
from app.core.supabase import supabase
from app.models.analysis import Analysis
from app.models.analysis_event import AnalysisEvent
from app.services.analysis_storage import build_analysis_video_path

logger = logging.getLogger(__name__)
SAFE_FAILURE_CODES = frozenset({"processing_error"})
OUTCOMES = frozenset({"completed", "zero_valid_reps", "insufficient_evidence"})


def _not_found(exc: StorageApiError) -> bool:
    return str(getattr(exc, "status", "")) == "404" or str(
        getattr(exc, "code", "")
    ) in {"404", "NoSuchKey", "not_found", "object_not_found"}


def _count(value: object) -> int | None:
    return value if type(value) is int and value >= 0 else None


def cleanup_expired_guest_analyses(
    db: Session, *, batch_size: int | None = None
) -> int:
    """Process one bounded batch. A failed storage deletion leaves its row retryable."""
    size = batch_size or settings.guest_cleanup_batch_size
    if size < 1 or size > 500:
        raise ValueError("Cleanup batch size must be between 1 and 500.")
    now = db.scalar(select(func.now()))
    if now is None:
        raise RuntimeError("Could not determine database time.")
    rows = list(
        db.scalars(
            select(Analysis)
            .where(
                Analysis.owner_kind == "guest",
                Analysis.guest_cleaned_at.is_(None),
                Analysis.access_expires_at <= now,
                Analysis.purge_after <= now,
                # Keep the signed network key for the entire abuse window.
                Analysis.created_at
                <= now - timedelta(minutes=settings.guest_rate_window_minutes),
                or_(
                    Analysis.status != "running",
                    Analysis.lease_expires_at <= now,
                ),
                or_(
                    Analysis.ai_feedback_status != "running",
                    Analysis.ai_feedback_lease_expires_at <= now,
                ),
            )
            .order_by(Analysis.updated_at, Analysis.id)
            .with_for_update(skip_locked=True)
            .limit(size)
        )
    )
    cleaned = 0
    storage = supabase.storage.from_(settings.supabase_video_bucket)
    for analysis in rows:
        # Use only the canonical path derived from the server-generated ID.
        # A reserved row may have uploaded a video without finalizing it.
        path = build_analysis_video_path(analysis.id)
        try:
            storage.remove([path])
        except StorageApiError as exc:
            if not _not_found(exc):
                logger.warning(
                    "Guest video deletion failed for analysis_id=%s", analysis.id
                )
                # Move a failing object behind other eligible rows next pass.
                analysis.updated_at = now
                continue

        if isinstance(analysis.result, dict):
            result = analysis.result
            if analysis.terminal_outcome is None and result.get("outcome") in OUTCOMES:
                analysis.terminal_outcome = result["outcome"]
            for name in ("valid_rep_count", "partial_rep_count", "uncertain_rep_count"):
                if getattr(analysis, name) is None:
                    setattr(analysis, name, _count(result.get(name)))
        if analysis.status == "completed" and analysis.completed_at is None:
            analysis.completed_at = analysis.updated_at
        if analysis.status == "failed" and analysis.failed_at is None:
            analysis.failed_at = analysis.updated_at
        if analysis.status not in {"completed", "failed"}:
            analysis.status = "expired"
            analysis.stage = "expired"
        analysis.error_code = (
            analysis.error_code if analysis.error_code in SAFE_FAILURE_CODES else None
        )
        db.execute(
            delete(AnalysisEvent).where(AnalysisEvent.analysis_id == analysis.id)
        )
        analysis.video_path = None
        analysis.video_delete_after = None
        analysis.guest_token_hash = None
        analysis.guest_rate_key = None
        analysis.reservation_operation_key = None
        analysis.request_fingerprint = None
        analysis.reservation_expires_at = None
        analysis.access_expires_at = None
        analysis.purge_after = None
        analysis.safety_documentation_id = None
        analysis.safety_ack_version = None
        analysis.safety_acknowledged_at = None
        analysis.claim_token = None
        analysis.lease_expires_at = None
        analysis.progress_snapshot = {}
        # SQLAlchemy's JSONB None otherwise becomes JSON null, not SQL NULL.
        analysis.result = null()
        analysis.ai_explanation = null()
        analysis.ai_feedback_status = "skipped"
        analysis.ai_feedback_attempts = 0
        analysis.ai_feedback_claim_token = None
        analysis.ai_feedback_lease_expires_at = None
        analysis.guest_cleaned_at = now
        cleaned += 1
    db.commit()
    return cleaned
