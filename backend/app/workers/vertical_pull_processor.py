from __future__ import annotations

import tempfile
from pathlib import Path
from threading import Event, Thread

from sqlalchemy.exc import SQLAlchemyError

from app.analyzers.pull_up.analyzer import analyze_vertical_pull_video
from app.core.config import settings
from app.core.supabase import supabase
from app.db.database import SessionLocal
from app.models.analysis import Analysis
from app.models.movement import Movement
from app.services.analysis_jobs import (
    AnalysisClaim,
    AnalysisClaimLostError,
    renew_analysis_lease,
)
from app.workers.analysis_worker import AnalysisProcessingResult


def process_vertical_pull(claim: AnalysisClaim) -> AnalysisProcessingResult:
    with SessionLocal() as db:
        analysis = db.get(Analysis, claim.analysis_id)
        movement = db.get(Movement, analysis.movement_id) if analysis else None
        if movement is None or movement.family_key != "vertical_pull":
            raise ValueError("Unsupported analysis movement family.")

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

    try:
        video_bytes = supabase.storage.from_(settings.supabase_video_bucket).download(
            claim.video_path
        )

        with tempfile.TemporaryDirectory() as temporary_directory:
            video_path = Path(temporary_directory) / "source.mp4"
            video_path.write_bytes(video_bytes)
            result = analyze_vertical_pull_video(video_path)
    finally:
        stop_heartbeat.set()
        heartbeat.join(timeout=1)

    return AnalysisProcessingResult(
        result_data=result.to_dict(),
        analyzer_version="vertical_pull_v1",
        model_version="mediapipe_tasks",
    )
