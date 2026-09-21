from __future__ import annotations

import logging
import time

from app.core.config import settings
from app.db.database import SessionLocal
from app.services.authenticated_media_cleanup import (
    cleanup_authenticated_analysis_media,
)
from app.services.guest_cleanup import cleanup_expired_guest_analyses

logger = logging.getLogger(__name__)


def run_guest_cleanup_worker() -> None:
    while True:
        try:
            with SessionLocal() as db:
                cleaned = cleanup_expired_guest_analyses(db)
                media_cleaned = cleanup_authenticated_analysis_media(db)
            if cleaned:
                logger.info("Cleaned %s expired guest analyses", cleaned)
            if media_cleaned:
                logger.info(
                    "Deleted media for %s authenticated analyses", media_cleaned
                )
        except Exception:
            logger.exception("Guest cleanup pass failed")
        time.sleep(settings.guest_cleanup_interval_seconds)
