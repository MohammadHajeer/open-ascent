"""Delete authenticated source media while preserving durable analysis history."""

from __future__ import annotations

import logging
from datetime import timedelta

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session
from storage3.exceptions import StorageApiError

from app.core.config import settings
from app.core.supabase import supabase
from app.models.analysis import Analysis
from app.services.analysis_storage import build_analysis_video_path
from app.services.feature_usage import release_usage

logger = logging.getLogger(__name__)
SIGNED_UPLOAD_RETENTION = timedelta(hours=3)


def expire_authenticated_analysis_reservations(
    db: Session, *, batch_size: int | None = None
) -> int:
    """Release unused quota and retain the path until upload tokens have expired."""
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
                Analysis.owner_kind == "authenticated",
                Analysis.status == "reserved",
                Analysis.reservation_expires_at <= now,
            )
            .order_by(Analysis.reservation_expires_at, Analysis.id)
            .with_for_update(skip_locked=True)
            .limit(size)
        )
    )
    for analysis in rows:
        if analysis.feature_usage_id is not None:
            release_usage(db, analysis.feature_usage_id, reason="analysis_reservation_expired")
        analysis.status = "expired"
        analysis.stage = "expired"
        # Supabase currently issues two-hour upload tokens. A late upload can
        # arrive after the reservation closes, so delete only after a margin.
        analysis.video_delete_after = (
            analysis.reservation_expires_at + SIGNED_UPLOAD_RETENTION
        )
    db.commit()
    return len(rows)


def _not_found(exc: StorageApiError) -> bool:
    return str(getattr(exc, "status", "")) == "404" or str(
        getattr(exc, "code", "")
    ) in {"404", "NoSuchKey", "not_found", "object_not_found"}


def cleanup_authenticated_analysis_media(
    db: Session, *, batch_size: int | None = None
) -> int:
    """Delete terminal media and abandoned uploads; missing objects count as success."""
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
                Analysis.owner_kind == "authenticated",
                or_(
                    (Analysis.status.in_(["completed", "failed"]))
                    & Analysis.video_path.is_not(None),
                    Analysis.status == "expired",
                ),
                Analysis.video_delete_after.is_not(None),
                Analysis.video_delete_after <= now,
            )
            .order_by(Analysis.video_delete_after, Analysis.id)
            .with_for_update(skip_locked=True)
            .limit(size)
        )
    )
    cleaned = 0
    storage = supabase.storage.from_(settings.supabase_video_bucket)
    for analysis in rows:
        path = build_analysis_video_path(analysis.id)
        try:
            storage.remove([path])
        except StorageApiError as exc:
            if not _not_found(exc):
                logger.warning(
                    "Authenticated video deletion failed for analysis_id=%s",
                    analysis.id,
                )
                analysis.updated_at = now
                continue
        analysis.video_path = None
        analysis.video_delete_after = None
        cleaned += 1
    db.commit()
    return cleaned
