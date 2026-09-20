from __future__ import annotations

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
from app.workers.analysis_worker import AnalysisProcessingResult


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

    classified_reps = []

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
        compared = compare_rep(rep, target_slug)
        classified_reps.append(compared)
        publish("rep_completed", rep=compared)

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
            publish("finalizing")
    finally:
        stop_heartbeat.set()
        heartbeat.join(timeout=1)

    result_data = result.to_dict()
    if classified_reps:
        result_data["reps"] = [asdict(rep) for rep in classified_reps]
    return AnalysisProcessingResult(
        result_data=result_data,
        analyzer_version="vertical_pull_v2",
        model_version="mediapipe_tasks",
    )
