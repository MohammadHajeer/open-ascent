from __future__ import annotations

import logging
import time

from sqlalchemy.exc import SQLAlchemyError

from app.core.config import settings
from app.db.database import SessionLocal
from app.models.analysis import Analysis
from app.models.movement import Movement
from app.models.movement_documentation import MovementDocumentation
from app.services.analysis_explanation import (
    build_explanation_input,
    generate_explanation,
)
from app.services.explanation_jobs import (
    ExplanationClaimLostError,
    claim_next_explanation,
    complete_explanation,
    fail_explanation,
)
from app.services.worker_monitor import WorkerMonitor

logger = logging.getLogger(__name__)


def process_one_explanation(monitor: WorkerMonitor | None = None) -> bool:
    with SessionLocal() as db:
        claim = claim_next_explanation(db)
    if claim is None:
        return False

    if monitor is not None:
        monitor.set_job(claim.analysis_id)

    try:
        with SessionLocal() as db:
            analysis = db.get(Analysis, claim.analysis_id)
            if analysis is None or analysis.result is None:
                raise ValueError("Completed analysis result is missing.")
            movement = (
                db.get(Movement, analysis.movement_id) if analysis.movement_id else None
            )
            documentation = db.get(
                MovementDocumentation, analysis.safety_documentation_id
            )
            if documentation is None or documentation.published_at is None:
                raise ValueError("Published movement guidance is missing.")
            source = build_explanation_input(
                result_data=analysis.result,
                movement_name=movement.name if movement else "Any Vertical Pull",
                safety_data=documentation.content,
            )

        explanation = generate_explanation(source)
        with SessionLocal() as db:
            complete_explanation(db, claim, explanation.model_dump())
    except ExplanationClaimLostError:
        logger.warning("Explanation claim expired: analysis_id=%s", claim.analysis_id)
    except Exception:
        logger.exception("Explanation failed: analysis_id=%s", claim.analysis_id)
        with SessionLocal() as db:
            try:
                fail_explanation(db, claim)
            except ExplanationClaimLostError:
                logger.warning(
                    "Failed explanation claim expired: analysis_id=%s",
                    claim.analysis_id,
                )
    if monitor is not None:
        monitor.set_job(None)
    return True


def run_explanation_worker() -> None:
    logger.info("Open Ascent explanation worker started.")
    monitor = WorkerMonitor("explanation")
    monitor.start()
    failed = False
    try:
        while True:
            try:
                found_job = process_one_explanation(monitor)
            except SQLAlchemyError:
                logger.exception("Explanation worker database error")
                monitor.set_job(None)
                found_job = False
            if not found_job:
                time.sleep(settings.analysis_worker_poll_interval_seconds)
    except Exception:
        failed = True
        raise
    finally:
        monitor.stop(failed=failed)
