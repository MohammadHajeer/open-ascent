from __future__ import annotations

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
) -> bool:
    # ---------------------------------------------------------
    # 1. Claim the job in a short DB transaction.
    # ---------------------------------------------------------

    with SessionLocal() as db:
        claim = claim_next_analysis(db)

    if claim is None:
        return False

    # ---------------------------------------------------------
    # 2. Process WITHOUT an open DB transaction.
    # ---------------------------------------------------------

    try:
        processing_result = processor(claim)

    except Exception:  # noqa: BLE001
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
                # Another worker already reclaimed the job.
                pass

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
            # This worker no longer owns the analysis.
            pass

    return True


def run_worker(
    processor: AnalysisProcessor,
) -> None:
    print("Open Ascent analysis worker started.")

    while True:
        try:
            found_job = process_one_analysis(processor)

        except SQLAlchemyError as exc:
            print(f"Worker database error: {exc}")

            time.sleep(settings.analysis_worker_poll_interval_seconds)

            continue

        if not found_job:
            time.sleep(settings.analysis_worker_poll_interval_seconds)
