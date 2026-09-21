from __future__ import annotations

import logging
import tempfile
from dataclasses import asdict
from pathlib import Path
from threading import Event, Thread

from sqlalchemy.exc import SQLAlchemyError

from app.analyzers.pull_up.analyzer import analyze_vertical_pull_video
from app.analyzers.pull_up.targets import compare_rep
from app.core.config import settings
from app.core.supabase import supabase
from app.db.database import SessionLocal
from app.models.analysis import Analysis
from app.models.movement import Movement
from app.services.analysis_events import publish_claim_event
from app.services.analysis_jobs import (
    AnalysisClaim,
    AnalysisClaimLostError,
    renew_analysis_lease,
)
from app.services.vertical_pull_visual_classifier import (
    classify_rep_visual,
    extract_representative_frames,
    fuse_visual_classification,
    unresolved_visual_dimensions,
)
from app.services.visual_classification_runs import (
    load_cached_visual_result,
    persist_visual_success,
    visual_operation_key,
)
from app.workers.analysis_worker import AnalysisProcessingResult

logger = logging.getLogger(__name__)


def _apply_visual_fallback(video_path: Path, rep, analysis_id):
    dimensions = unresolved_visual_dimensions(rep)
    if not dimensions or not settings.openai_visual_classifier_enabled:
        return fuse_visual_classification(rep, None)

    operation_key = visual_operation_key(analysis_id, rep.rep_index, dimensions)
    try:
        with SessionLocal() as db:
            cached = load_cached_visual_result(
                db,
                operation_key=operation_key,
                rep_index=rep.rep_index,
                dimensions=dimensions,
            )
    except Exception:
        # Without a trustworthy cache read, skip the optional call rather than
        # risk duplicate provider spend during a retry.
        logger.exception(
            "Visual fallback cache read failed: analysis_id=%s rep_index=%s",
            analysis_id,
            rep.rep_index,
        )
        return fuse_visual_classification(rep, None)

    if cached is not None:
        return fuse_visual_classification(rep, cached)

    try:
        frames = extract_representative_frames(video_path, rep)
        call = classify_rep_visual(
            rep_index=rep.rep_index,
            dimensions=dimensions,
            image_data_urls=frames,
        )
    except Exception:
        logger.exception(
            "Visual fallback failed: analysis_id=%s rep_index=%s",
            analysis_id,
            rep.rep_index,
        )
        return fuse_visual_classification(rep, None)

    try:
        with SessionLocal() as db:
            persist_visual_success(
                db,
                analysis_id=analysis_id,
                operation_key=operation_key,
                dimensions=dimensions,
                call=call,
            )
    except Exception:
        # The current deterministic analysis can still use the validated
        # response. A later retry may call again only because persistence failed.
        logger.exception(
            "Visual fallback cache write failed: analysis_id=%s rep_index=%s",
            analysis_id,
            rep.rep_index,
        )
    return fuse_visual_classification(rep, call.result)


def process_vertical_pull(claim: AnalysisClaim) -> AnalysisProcessingResult:
    with SessionLocal() as db:
        analysis = db.get(Analysis, claim.analysis_id)
        movement = (
            db.get(Movement, analysis.movement_id)
            if analysis and analysis.movement_id
            else None
        )
        family_key = getattr(analysis, "family_key", None) or (
            movement.family_key if movement else None
        )
        if (
            family_key != "vertical_pull"
            or (analysis.movement_id and movement is None)
            or (movement and movement.family_key != family_key)
        ):
            raise ValueError("Unsupported analysis movement family.")
        target_slug = movement.slug if movement else None

    stop_heartbeat = Event()

    def keep_lease() -> None:
        interval = max(1, settings.analysis_worker_lease_seconds // 3)
        while not stop_heartbeat.wait(interval):
            try:
                with SessionLocal() as db:
                    renew_analysis_lease(db, claim)
            except AnalysisClaimLostError:
                return
            except SQLAlchemyError:
                # A later heartbeat or the final compare-and-swap will decide
                # whether this worker still owns the claim.
                continue

    heartbeat = Thread(target=keep_lease, daemon=True)
    heartbeat.start()

    deterministic_reps = []

    def publish(event_type: str, *, rep=None) -> None:
        with SessionLocal() as db:
            publish_claim_event(
                db,
                claim,
                event_type,
                rep_index=rep.rep_index if rep else None,
                outcome=rep.outcome.value if rep else None,
                variations=rep.variations if rep else None,
                target_match=rep.target_match if rep else None,
                target_deviations=rep.target_deviations if rep else None,
            )

    def completed_rep(rep):
        deterministic_reps.append(rep)

    try:
        video_bytes = supabase.storage.from_(settings.supabase_video_bucket).download(
            claim.video_path
        )

        with tempfile.TemporaryDirectory() as temporary_directory:
            video_path = Path(temporary_directory) / "source.mp4"
            video_path.write_bytes(video_bytes)
            publish("video_loaded")
            publish("movement_analysis_started")
            result = analyze_vertical_pull_video(
                video_path,
                on_rep_completed=completed_rep,
            )
            final_reps = []
            provenance_by_rep = {}
            for deterministic_rep in deterministic_reps:
                fused_rep, provenance = _apply_visual_fallback(
                    video_path, deterministic_rep, claim.analysis_id
                )
                compared = compare_rep(fused_rep, target_slug)
                final_reps.append(compared)
                provenance_by_rep[compared.rep_index] = provenance
                publish("rep_completed", rep=compared)
            publish("finalizing")
    finally:
        stop_heartbeat.set()
        heartbeat.join(timeout=1)

    result_data = result.to_dict()
    if final_reps:
        result_data["reps"] = []
        for rep in final_reps:
            rep_data = asdict(rep)
            rep_data["_classification_provenance"] = provenance_by_rep[rep.rep_index]
            result_data["reps"].append(rep_data)
    return AnalysisProcessingResult(
        result_data=result_data,
        analyzer_version="vertical_pull_v3",
        model_version="mediapipe_tasks",
    )
