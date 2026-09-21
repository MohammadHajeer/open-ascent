"""Delete authenticated source media while preserving durable analysis history."""

from __future__ import annotations

import logging

from sqlalchemy import func, select
from sqlalchemy.orm import Session
from storage3.exceptions import StorageApiError

from app.core.config import settings
from app.core.supabase import supabase
from app.models.analysis import Analysis
from app.services.analysis_storage import build_analysis_video_path

logger = logging.getLogger(__name__)


def _not_found(exc: StorageApiError) -> bool:
    return str(getattr(exc, "status", "")) == "404" or str(
        getattr(exc, "code", "")
    ) in {"404", "NoSuchKey", "not_found", "object_not_found"}


def cleanup_authenticated_analysis_media(
    db: Session, *, batch_size: int | None = None
) -> int:
    """Delete terminal authenticated videos; missing objects count as success."""
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
                Analysis.status.in_(["completed", "failed"]),
                Analysis.video_path.is_not(None),
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
