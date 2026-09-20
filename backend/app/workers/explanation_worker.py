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

logger = logging.getLogger(__name__)


def process_one_explanation() -> bool:
    with SessionLocal() as db:
        claim = claim_next_explanation(db)
    if claim is None:
        return False

    try:
        with SessionLocal() as db:
            analysis = db.get(Analysis, claim.analysis_id)
            if analysis is None or analysis.result is None:
                raise ValueError("Completed analysis result is missing.")
            movement = db.get(Movement, analysis.movement_id)
            documentation = db.get(
                MovementDocumentation, analysis.safety_documentation_id
            )
            if (
                movement is None
                or documentation is None
                or documentation.published_at is None
            ):
                raise ValueError("Published movement guidance is missing.")
            source = build_explanation_input(
                result_data=analysis.result,
                movement_name=movement.name,
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
    return True


def run_explanation_worker() -> None:
    logger.info("Open Ascent explanation worker started.")
    while True:
        try:
            found_job = process_one_explanation()
        except SQLAlchemyError:
            logger.exception("Explanation worker database error")
            found_job = False
        if not found_job:
            time.sleep(settings.analysis_worker_poll_interval_seconds)
