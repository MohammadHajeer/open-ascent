"""Run an existing uploaded analysis repeatedly through the real processor.

This diagnostic reads its existing private video and does not change analysis status.
Run from backend: python -m scripts.repeat_analysis_processor ANALYSIS_ID --runs 5
"""

from __future__ import annotations

import argparse
import json
import time
import traceback
import uuid

from app.db.database import SessionLocal
from app.models.analysis import Analysis
from app.services.analysis_jobs import AnalysisClaim
from app.workers.vertical_pull_processor import process_vertical_pull


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("analysis_id", type=uuid.UUID)
    parser.add_argument("--runs", type=int, default=5)
    args = parser.parse_args()
    if not 1 <= args.runs <= 10:
        parser.error("--runs must be between 1 and 10")

    with SessionLocal() as db:
        analysis = db.get(Analysis, args.analysis_id)
        if analysis is None or not analysis.video_path:
            parser.error("Analysis with an uploaded video was not found")
        claim = AnalysisClaim(
            analysis_id=analysis.id,
            claim_token="diagnostic-only",
            attempt=0,
            video_path=analysis.video_path,
        )

    failures = 0
    for run in range(1, args.runs + 1):
        started = time.perf_counter()
        try:
            result = process_vertical_pull(claim)
            json.dumps(result.result_data, allow_nan=False)
            print(
                f"run {run} PASS {time.perf_counter() - started:.1f}s "
                f"outcome={result.result_data['outcome']}",
                flush=True,
            )
        except Exception as exc:  # noqa: BLE001
            failures += 1
            print(
                f"run {run} FAIL {time.perf_counter() - started:.1f}s "
                f"{type(exc).__name__}: {exc}",
                flush=True,
            )
            traceback.print_exc()

    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
