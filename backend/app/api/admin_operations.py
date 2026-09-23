from __future__ import annotations

import uuid
from datetime import UTC, datetime, time, timedelta
from typing import Literal

from fastapi import APIRouter, HTTPException, Query
from sqlalchemy import and_, func, literal, or_, select, union_all

from app.api.dependencies.auth import AdminProfile
from app.db.database import DbSession
from app.models.analysis import Analysis
from app.models.analysis_event import AnalysisEvent
from app.models.profile import Profile
from app.models.worker_instance import WorkerInstance
from app.services.analysis_jobs import (
    MAX_ANALYSIS_ATTEMPTS,
    AnalysisRetryUnavailableError,
    retry_failed_analysis,
)
from app.services.explanation_jobs import (
    MAX_EXPLANATION_ATTEMPTS,
    ExplanationRetryUnavailableError,
    retry_failed_explanation,
)
from app.services.worker_monitor import (
    FAILED_AFTER_SECONDS,
    HEARTBEAT_SECONDS,
    STALE_AFTER_SECONDS,
)

router = APIRouter(prefix="/admin/operations", tags=["admin operations"])
QUEUE_STALE_MINUTES = 10


def _now(db: DbSession):
    return db.scalar(select(func.now()))


def _health(worker: WorkerInstance, now) -> str:
    if worker.state in {"failed", "stopped"}:
        return worker.state
    age = (now - worker.last_seen_at).total_seconds()
    if age > FAILED_AFTER_SECONDS:
        return "failed"
    if age > STALE_AFTER_SECONDS:
        return "stale"
    return "healthy"


def _job_rows():
    explanation_failure_at = (
        select(func.max(AnalysisEvent.created_at))
        .where(
            AnalysisEvent.analysis_id == Analysis.id,
            AnalysisEvent.event_type == "explanation_failed",
        )
        .correlate(Analysis)
        .scalar_subquery()
    )
    return union_all(
        select(
            Analysis.id.label("id"),
            literal("analysis").label("kind"),
            Analysis.status.label("status"),
            Analysis.owner_kind.label("owner_kind"),
            Analysis.created_at.label("queued_at"),
            Analysis.lease_expires_at.label("lease_expires_at"),
            Analysis.attempts.label("attempts"),
            Analysis.error_code.label("error_code"),
            Analysis.failed_at.label("failed_at"),
            Analysis.video_path.label("video_path"),
            Analysis.access_expires_at.label("access_expires_at"),
            Analysis.feature_usage_id.label("feature_usage_id"),
            Analysis.guest_cleaned_at.label("guest_cleaned_at"),
        ).where(Analysis.status.in_(["queued", "running", "failed"])),
        select(
            Analysis.id.label("id"),
            literal("explanation").label("kind"),
            Analysis.ai_feedback_status.label("status"),
            Analysis.owner_kind.label("owner_kind"),
            func.coalesce(Analysis.completed_at, Analysis.created_at).label(
                "queued_at"
            ),
            Analysis.ai_feedback_lease_expires_at.label("lease_expires_at"),
            Analysis.ai_feedback_attempts.label("attempts"),
            literal(None).label("error_code"),
            explanation_failure_at.label("failed_at"),
            literal(None).label("video_path"),
            Analysis.access_expires_at.label("access_expires_at"),
            literal(None).label("feature_usage_id"),
            literal(None).label("guest_cleaned_at"),
        ).where(
            Analysis.status == "completed",
            Analysis.ai_feedback_status.in_(["pending", "running", "failed"]),
        ),
    ).subquery()


def _safe_failure(kind: str, code: str | None) -> str:
    if kind == "explanation":
        return "Explanation processing failed or timed out."
    return {
        "attempts_exhausted": "The analysis did not complete within three attempts.",
        "processing_error": "The analysis processor reported a failure.",
    }.get(code or "", "Analysis processing failed.")


def _page(db, *, kind, status, failures_only, page, page_size):
    rows = _job_rows()
    conditions = []
    if kind != "all":
        conditions.append(rows.c.kind == kind)
    if failures_only:
        conditions.append(rows.c.status == "failed")
    elif status != "all":
        conditions.append(rows.c.status == status)
    total = db.scalar(select(func.count()).select_from(rows).where(*conditions)) or 0
    selected = db.execute(
        select(rows)
        .where(*conditions)
        .order_by(
            func.coalesce(rows.c.failed_at, rows.c.queued_at).desc(), rows.c.id.desc()
        )
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).all()
    now = _now(db)
    items = []
    for row in selected:
        job = row._mapping
        stale = (
            job["status"] == "running"
            and job["lease_expires_at"] is not None
            and job["lease_expires_at"] <= now
        ) or (
            job["status"] in {"queued", "pending"}
            and job["queued_at"] <= now - timedelta(minutes=QUEUE_STALE_MINUTES)
        )
        items.append(
            {
                "id": job["id"],
                "kind": job["kind"],
                "status": job["status"],
                "owner_kind": job["owner_kind"],
                "queued_at": job["queued_at"],
                "lease_expires_at": job["lease_expires_at"],
                "failed_at": job["failed_at"],
                "attempts": job["attempts"],
                "max_attempts": MAX_ANALYSIS_ATTEMPTS
                if job["kind"] == "analysis"
                else MAX_EXPLANATION_ATTEMPTS,
                "stale": stale,
                "failure_code": (
                    (
                        job["error_code"]
                        if job["error_code"]
                        in {"attempts_exhausted", "processing_error"}
                        else "other"
                    )
                    if job["kind"] == "analysis" and job["status"] == "failed"
                    else "explanation_failed"
                    if job["kind"] == "explanation" and job["status"] == "failed"
                    else None
                ),
                "failure_detail": _safe_failure(job["kind"], job["error_code"])
                if job["status"] == "failed"
                else None,
                "retry_available": (
                    job["status"] == "failed"
                    and (
                        (
                            job["kind"] == "analysis"
                            and job["owner_kind"] == "guest"
                            and job["attempts"] < MAX_ANALYSIS_ATTEMPTS
                            and job["video_path"] is not None
                            and job["feature_usage_id"] is None
                            and job["guest_cleaned_at"] is None
                            and job["access_expires_at"] is not None
                            and job["access_expires_at"] > now
                        )
                        or (
                            job["kind"] == "explanation"
                            and job["attempts"] < MAX_EXPLANATION_ATTEMPTS
                            and (
                                job["owner_kind"] != "guest"
                                or (
                                    job["access_expires_at"] is not None
                                    and job["access_expires_at"] > now
                                )
                            )
                        )
                    )
                ),
            }
        )
    return {
        "as_of": now,
        "page": page,
        "page_size": page_size,
        "total": total,
        "items": items,
    }


@router.get("/overview")
def overview(db: DbSession, _admin: AdminProfile):
    now = _now(db)
    since = now - timedelta(hours=24)
    first_day = now.astimezone(UTC).date() - timedelta(days=6)
    window_start = datetime.combine(first_day, time.min, UTC)
    completed_day = func.date(func.timezone("UTC", Analysis.completed_at))
    failed_day = func.date(func.timezone("UTC", Analysis.failed_at))
    daily = {
        first_day + timedelta(days=offset): {"completed": 0, "failed": 0}
        for offset in range(7)
    }
    for status, day, total in db.execute(
        union_all(
            select(literal("completed"), completed_day, func.count())
            .where(Analysis.completed_at >= window_start)
            .group_by(completed_day),
            select(literal("failed"), failed_day, func.count())
            .where(Analysis.failed_at >= window_start)
            .group_by(failed_day),
        )
    ):
        if day in daily:
            daily[day][status] = total
    profile_counts = dict(
        db.execute(
            select(Profile.app_role, func.count()).group_by(Profile.app_role)
        ).all()
    )
    analysis_counts = dict(
        db.execute(
            select(Analysis.status, func.count()).group_by(Analysis.status)
        ).all()
    )
    explanation_counts = dict(
        db.execute(
            select(Analysis.ai_feedback_status, func.count())
            .where(Analysis.status == "completed", Analysis.result.is_not(None))
            .group_by(Analysis.ai_feedback_status)
        ).all()
    )
    workers = db.scalars(
        select(WorkerInstance).where(
            WorkerInstance.last_seen_at >= now - timedelta(days=1)
        )
    ).all()
    health = {key: 0 for key in ("healthy", "stale", "failed", "stopped")}
    for worker in workers:
        health[_health(worker, now)] += 1
    stale_analysis = (
        db.scalar(
            select(func.count())
            .select_from(Analysis)
            .where(
                or_(
                    and_(
                        Analysis.status == "running", Analysis.lease_expires_at <= now
                    ),
                    and_(
                        Analysis.status == "queued",
                        Analysis.created_at
                        <= now - timedelta(minutes=QUEUE_STALE_MINUTES),
                    ),
                )
            )
        )
        or 0
    )
    stale_explanation = (
        db.scalar(
            select(func.count())
            .select_from(Analysis)
            .where(
                Analysis.status == "completed",
                or_(
                    and_(
                        Analysis.ai_feedback_status == "running",
                        Analysis.ai_feedback_lease_expires_at <= now,
                    ),
                    and_(
                        Analysis.ai_feedback_status == "pending",
                        func.coalesce(Analysis.completed_at, Analysis.created_at)
                        <= now - timedelta(minutes=QUEUE_STALE_MINUTES),
                    ),
                ),
            )
        )
        or 0
    )
    return {
        "as_of": now,
        "users": {
            "total": sum(profile_counts.values()),
            "athletes": profile_counts.get("athlete", 0),
        },
        "analyses": analysis_counts,
        "explanations": explanation_counts,
        "queue_depth": analysis_counts.get("queued", 0)
        + explanation_counts.get("pending", 0),
        "stale_jobs": stale_analysis + stale_explanation,
        "failed_jobs": analysis_counts.get("failed", 0)
        + explanation_counts.get("failed", 0),
        "worker_health": health,
        "throughput_24h": {
            "completed": db.scalar(
                select(func.count())
                .select_from(Analysis)
                .where(Analysis.completed_at >= since)
            )
            or 0,
            "failed": db.scalar(
                select(func.count())
                .select_from(Analysis)
                .where(Analysis.failed_at >= since)
            )
            or 0,
        },
        "throughput_daily": [
            {"date": day.isoformat(), **counts} for day, counts in daily.items()
        ],
        "thresholds": {
            "heartbeat_seconds": HEARTBEAT_SECONDS,
            "stale_after_seconds": STALE_AFTER_SECONDS,
            "failed_after_seconds": FAILED_AFTER_SECONDS,
            "queue_stale_minutes": QUEUE_STALE_MINUTES,
        },
    }


@router.get("/workers")
def workers(
    db: DbSession,
    _admin: AdminProfile,
    page: int = Query(1, ge=1, le=1000),
    page_size: int = Query(20, ge=1, le=100),
):
    now = _now(db)
    total = db.scalar(select(func.count()).select_from(WorkerInstance)) or 0
    entries = db.scalars(
        select(WorkerInstance)
        .order_by(WorkerInstance.last_seen_at.desc(), WorkerInstance.id.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).all()
    return {
        "as_of": now,
        "page": page,
        "page_size": page_size,
        "total": total,
        "items": [
            {
                "id": worker.id,
                "worker_type": worker.worker_type,
                "state": worker.state,
                "health": _health(worker, now),
                "current_job_id": worker.current_job_id,
                "started_at": worker.started_at,
                "last_seen_at": worker.last_seen_at,
            }
            for worker in entries
        ],
    }


@router.get("/jobs")
def jobs(
    db: DbSession,
    _admin: AdminProfile,
    kind: Literal["all", "analysis", "explanation"] = "all",
    status: Literal["all", "queued", "pending", "running", "failed"] = "all",
    page: int = Query(1, ge=1, le=1000),
    page_size: int = Query(20, ge=1, le=100),
):
    return _page(
        db,
        kind=kind,
        status=status,
        failures_only=False,
        page=page,
        page_size=page_size,
    )


@router.get("/failures")
def failures(
    db: DbSession,
    _admin: AdminProfile,
    kind: Literal["all", "analysis", "explanation"] = "all",
    page: int = Query(1, ge=1, le=1000),
    page_size: int = Query(20, ge=1, le=100),
):
    return _page(
        db,
        kind=kind,
        status="failed",
        failures_only=True,
        page=page,
        page_size=page_size,
    )


@router.post("/jobs/analysis/{analysis_id}/retry", status_code=202)
def retry_analysis(analysis_id: uuid.UUID, db: DbSession, _admin: AdminProfile):
    try:
        retry_failed_analysis(db, analysis_id)
    except AnalysisRetryUnavailableError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return {"status": "queued"}


@router.post("/jobs/explanation/{analysis_id}/retry", status_code=202)
def retry_explanation(analysis_id: uuid.UUID, db: DbSession, _admin: AdminProfile):
    try:
        status = retry_failed_explanation(db, analysis_id)
    except ExplanationRetryUnavailableError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return {"status": status}
