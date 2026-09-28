"""Athlete-safe view of analysis worker availability and queue position.

Derived only from the existing durable queue (``analyses``) and the worker
heartbeats in ``worker_instances``. Nothing here exposes worker IDs, leases,
heartbeat timestamps or other athletes' analyses; callers get a coarse
service state and, for their own queued analysis, a count of jobs ahead.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import timedelta
from typing import Literal

from sqlalchemy import exists, func, select
from sqlalchemy.orm import Session

from app.models.analysis import Analysis
from app.models.worker_instance import WorkerInstance
from app.services.analysis_jobs import claimable_analysis_conditions
from app.services.worker_monitor import STALE_AFTER_SECONDS

ServiceState = Literal["ready", "busy", "unavailable"]


class AnalysisServiceUnavailableError(Exception):
    pass


@dataclass(frozen=True)
class AnalysisQueueSnapshot:
    service_state: ServiceState
    # Claimable queued analyses the worker will take before this one. None
    # when the analysis is not waiting in the queue.
    analyses_ahead: int | None

    def as_dict(self) -> dict:
        return {
            "service_state": self.service_state,
            "analyses_ahead": self.analyses_ahead,
        }


def _healthy_worker_states(db: Session) -> list[str]:
    # Same rule as the admin operations page: a worker is healthy while it
    # reports idle/busy and its heartbeat is no older than STALE_AFTER_SECONDS.
    return list(
        db.scalars(
            select(WorkerInstance.state).where(
                WorkerInstance.worker_type == "analysis",
                WorkerInstance.state.in_(["idle", "busy"]),
                WorkerInstance.last_seen_at
                > func.now() - timedelta(seconds=STALE_AFTER_SECONDS),
            )
        )
    )


def analysis_service_state(db: Session) -> ServiceState:
    states = _healthy_worker_states(db)
    if not states:
        return "unavailable"
    if "idle" not in states:
        return "busy"
    waiting = db.scalar(
        select(
            exists().where(
                Analysis.status == "queued", *claimable_analysis_conditions()
            )
        )
    )
    return "busy" if waiting else "ready"


def require_analysis_service_available(db: Session) -> None:
    """Admission check for new analyses; the worker must be alive right now."""
    if not _healthy_worker_states(db):
        raise AnalysisServiceUnavailableError


def analyses_ahead_of(db: Session, analysis: Analysis) -> int | None:
    """Queued analyses the worker will claim before this one.

    The worker claims queued jobs oldest ``created_at`` first and only
    re-claims expired running leases after every queued job, so the jobs
    ahead are exactly the older claimable queued ones. Equal timestamps have
    no defined order, so they are counted as ahead.
    """
    own = db.scalar(
        select(Analysis.id).where(
            Analysis.id == analysis.id,
            Analysis.status == "queued",
            *claimable_analysis_conditions(),
        )
    )
    if own is None:
        return None
    return (
        db.scalar(
            select(func.count())
            .select_from(Analysis)
            .where(
                Analysis.status == "queued",
                *claimable_analysis_conditions(),
                Analysis.id != analysis.id,
                Analysis.created_at <= analysis.created_at,
            )
        )
        or 0
    )


def analysis_queue_snapshot(
    db: Session, analysis: Analysis
) -> AnalysisQueueSnapshot | None:
    if analysis.status not in {"queued", "running"}:
        return None
    return AnalysisQueueSnapshot(
        service_state=analysis_service_state(db),
        analyses_ahead=(
            analyses_ahead_of(db, analysis) if analysis.status == "queued" else None
        ),
    )
