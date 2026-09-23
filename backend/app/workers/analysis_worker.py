from __future__ import annotations

import logging
import time
from collections.abc import Callable
from dataclasses import dataclass

from sqlalchemy.exc import SQLAlchemyError

from app.core.config import settings
from app.db.database import SessionLocal
from app.services.analysis_jobs import (
    AnalysisClaim,
    AnalysisClaimLostError,
    claim_next_analysis,
    complete_analysis,
    fail_analysis,
)
from app.services.worker_monitor import WorkerMonitor

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class AnalysisProcessingResult:
    result_data: dict
    analyzer_version: str
    model_version: str


AnalysisProcessor = Callable[
    [AnalysisClaim],
    AnalysisProcessingResult,
]


def process_one_analysis(
    processor: AnalysisProcessor,
    monitor: WorkerMonitor | None = None,
) -> bool:
    # ---------------------------------------------------------
    # 1. Claim the job in a short DB transaction.
    # ---------------------------------------------------------

    with SessionLocal() as db:
        claim = claim_next_analysis(db)

    if claim is None:
        return False

    if monitor is not None:
        monitor.set_job(claim.analysis_id)

    # ---------------------------------------------------------
    # 2. Process WITHOUT an open DB transaction.
    # ---------------------------------------------------------

    try:
        processing_result = processor(claim)

    except Exception:
        logger.exception(
            "Analysis processor failed: analysis_id=%s attempt=%s",
            claim.analysis_id,
            claim.attempt,
        )
        # -----------------------------------------------------
        # 3A. Save failure using a new short DB transaction.
        # -----------------------------------------------------

        with SessionLocal() as db:
            try:
                fail_analysis(
                    db,
                    claim,
                    error_code="processing_error",
                )
            except AnalysisClaimLostError:
                logger.warning(
                    "Failed analysis claim was already lost: analysis_id=%s attempt=%s",
                    claim.analysis_id,
                    claim.attempt,
                )

        if monitor is not None:
            monitor.set_job(None)
        return True

    # ---------------------------------------------------------
    # 3B. Save successful result using a new short transaction.
    # ---------------------------------------------------------

    with SessionLocal() as db:
        try:
            complete_analysis(
                db,
                claim,
                result_data=processing_result.result_data,
                analyzer_version=processing_result.analyzer_version,
                model_version=processing_result.model_version,
            )
        except AnalysisClaimLostError:
            logger.warning(
                "Completed analysis claim was already lost: analysis_id=%s attempt=%s",
                claim.analysis_id,
                claim.attempt,
            )

    if monitor is not None:
        monitor.set_job(None)

    return True


def run_worker(
    processor: AnalysisProcessor,
) -> None:
    logger.info("Open Ascent analysis worker started.")
    monitor = WorkerMonitor("analysis")
    monitor.start()
    failed = False
    try:
        while True:
            try:
                found_job = process_one_analysis(processor, monitor)
            except SQLAlchemyError:
                logger.exception("Analysis worker database error")
                monitor.set_job(None)
                time.sleep(settings.analysis_worker_poll_interval_seconds)
                continue
            if not found_job:
                time.sleep(settings.analysis_worker_poll_interval_seconds)
    except Exception:
        failed = True
        raise
    finally:
        monitor.stop(failed=failed)
