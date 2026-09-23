from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from typing import Literal

from fastapi import APIRouter, HTTPException, Query
from pydantic import ValidationError
from sqlalchemy import func, select

from app.api.dependencies.auth import AdminProfile
from app.db.database import DbSession
from app.models.analysis import Analysis
from app.models.movement import Movement
from app.models.profile import Profile
from app.models.subscription import FeatureUsage, PlanEntitlement, SubscriptionPlan
from app.models.training import TrainingPlan
from app.schemas.training_plan import WeeklyPlanCandidate
from app.services.entitlements import (
    _effective_pro_users_query,
    effective_pro_user_ids,
    resolve_effective_plan,
)
from app.services.feature_usage import calendar_month_window

router = APIRouter(prefix="/admin/management", tags=["admin management"])
PageNumber = Query(1, ge=1, le=1000)
PageSize = Query(20, ge=1, le=100)


def _page(items, total: int, page: int, page_size: int):
    return {"page": page, "page_size": page_size, "total": total, "items": items}


def _safe_error(code: str | None) -> str | None:
    if code == "attempts_exhausted":
        return "The analysis exhausted its attempt limit."
    if code == "processing_error":
        return "The analysis processor failed."
    return "Analysis processing failed."


def _usage_by_user(db, user_ids: list[uuid.UUID], start: datetime, end: datetime):
    if not user_ids:
        return {}
    rows = db.execute(
        select(
            FeatureUsage.user_id,
            FeatureUsage.feature_key,
            FeatureUsage.status,
            func.sum(FeatureUsage.units),
        )
        .where(
            FeatureUsage.user_id.in_(user_ids),
            FeatureUsage.window_start == start,
            FeatureUsage.window_end == end,
            FeatureUsage.status.in_(["consumed", "reserved"]),
        )
        .group_by(FeatureUsage.user_id, FeatureUsage.feature_key, FeatureUsage.status)
    )
    result: dict[uuid.UUID, dict[str, dict[str, int]]] = {}
    for user_id, feature, status, units in rows:
        result.setdefault(user_id, {}).setdefault(
            feature, {"consumed": 0, "reserved": 0}
        )[status] = int(units)
    return result


@router.get("/summary")
def management_summary(db: DbSession, _admin: AdminProfile):
    now = datetime.now(UTC)
    start, end = calendar_month_window(now)
    roles = dict(
        db.execute(select(Profile.app_role, func.count()).group_by(Profile.app_role))
    )
    onboarded = (
        db.scalar(
            select(func.count())
            .select_from(Profile)
            .where(
                Profile.app_role == "athlete",
                Profile.onboarding_completed_at.is_not(None),
            )
        )
        or 0
    )
    effective_pro = _effective_pro_users_query(None, now).subquery()
    pro_athletes = (
        db.scalar(
            select(func.count())
            .select_from(Profile)
            .where(
                Profile.app_role == "athlete",
                Profile.id.in_(select(effective_pro.c.user_id)),
            )
        )
        or 0
    )
    usage = {}
    for feature, status, units in db.execute(
        select(
            FeatureUsage.feature_key, FeatureUsage.status, func.sum(FeatureUsage.units)
        )
        .join(Profile, Profile.id == FeatureUsage.user_id)
        .where(
            Profile.app_role == "athlete",
            FeatureUsage.window_start == start,
            FeatureUsage.window_end == end,
            FeatureUsage.status.in_(["consumed", "reserved"]),
        )
        .group_by(FeatureUsage.feature_key, FeatureUsage.status)
    ):
        usage.setdefault(feature, {"consumed": 0, "reserved": 0})[status] = int(units)
    plans_total = db.scalar(select(func.count()).select_from(TrainingPlan)) or 0
    plans_recent = (
        db.scalar(
            select(func.count())
            .select_from(TrainingPlan)
            .where(TrainingPlan.saved_at >= now - timedelta(days=30))
        )
        or 0
    )
    return {
        "as_of": now,
        "users": {
            "total": sum(roles.values()),
            "athletes": roles.get("athlete", 0),
            "admins": roles.get("admin", 0),
            "onboarded_athletes": onboarded,
        },
        "tiers": {
            "pro_athletes": pro_athletes,
            "free_athletes": roles.get("athlete", 0) - pro_athletes,
        },
        "usage_window": {"start": start, "end": end},
        "usage": usage,
        "plans": {"total": plans_total, "saved_30d": plans_recent},
    }


@router.get("/users")
def list_users(
    db: DbSession,
    _admin: AdminProfile,
    page: int = PageNumber,
    page_size: int = PageSize,
    q: str | None = Query(None, max_length=80),
    role: Literal["all", "athlete", "admin"] = "all",
):
    conditions = []
    if role != "all":
        conditions.append(Profile.app_role == role)
    if q and q.strip():
        escaped = (
            q.strip().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        )
        conditions.append(Profile.display_name.ilike(f"%{escaped}%", escape="\\"))
    total = db.scalar(select(func.count()).select_from(Profile).where(*conditions)) or 0
    analyses = (
        select(Analysis.user_id, func.count().label("analysis_count"))
        .where(Analysis.owner_kind == "authenticated")
        .group_by(Analysis.user_id)
        .subquery()
    )
    rows = db.execute(
        select(
            Profile.id,
            Profile.display_name,
            Profile.app_role,
            Profile.created_at,
            Profile.onboarding_completed_at,
            func.coalesce(analyses.c.analysis_count, 0),
        )
        .outerjoin(analyses, analyses.c.user_id == Profile.id)
        .where(*conditions)
        .order_by(Profile.created_at.desc(), Profile.id.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    return _page(
        [
            {
                "id": uid,
                "display_name": name,
                "role": app_role,
                "created_at": created,
                "onboarding_complete": onboarded is not None,
                "analysis_count": analysis_count,
            }
            for uid, name, app_role, created, onboarded, analysis_count in rows
        ],
        total,
        page,
        page_size,
    )


@router.get("/users/{user_id}")
def get_user(user_id: uuid.UUID, db: DbSession, _admin: AdminProfile):
    profile = db.get(Profile, user_id)
    if profile is None:
        raise HTTPException(404, "Account not found.")
    plan_code = resolve_effective_plan(db, user_id).value
    now = datetime.now(UTC)
    start, end = calendar_month_window(now)
    usage = _usage_by_user(db, [user_id], start, end).get(user_id, {})
    entitlements = db.execute(
        select(
            PlanEntitlement.feature_key,
            PlanEntitlement.entitlement_type,
            PlanEntitlement.enabled,
            PlanEntitlement.allowance_units,
        )
        .join(SubscriptionPlan, SubscriptionPlan.id == PlanEntitlement.plan_id)
        .where(SubscriptionPlan.code == plan_code)
        .order_by(PlanEntitlement.feature_key)
    )
    return {
        "id": profile.id,
        "display_name": profile.display_name,
        "role": profile.app_role,
        "created_at": profile.created_at,
        "onboarding_completed_at": profile.onboarding_completed_at,
        "effective_plan": plan_code,
        "usage_window": {"start": start, "end": end},
        "usage": usage,
        "entitlements": [
            {
                "feature_key": feature,
                "type": kind,
                "enabled": enabled,
                "allowance_units": allowance,
            }
            for feature, kind, enabled, allowance in entitlements
        ],
    }


@router.get("/analyses")
def list_analyses(
    db: DbSession,
    _admin: AdminProfile,
    page: int = PageNumber,
    page_size: int = PageSize,
    status: Literal[
        "all", "reserved", "queued", "running", "completed", "failed", "expired"
    ] = "all",
    owner: Literal["all", "guest", "authenticated"] = "all",
    user_id: uuid.UUID | None = None,
    movement_id: uuid.UUID | None = None,
):
    conditions = []
    if status != "all":
        conditions.append(Analysis.status == status)
    if owner != "all":
        conditions.append(Analysis.owner_kind == owner)
    if user_id is not None:
        conditions.append(Analysis.user_id == user_id)
    if movement_id is not None:
        conditions.append(Analysis.movement_id == movement_id)
    total = (
        db.scalar(select(func.count()).select_from(Analysis).where(*conditions)) or 0
    )
    rows = db.execute(
        select(
            Analysis.id,
            Analysis.user_id,
            Profile.display_name,
            Analysis.owner_kind,
            Analysis.status,
            Analysis.stage,
            Analysis.created_at,
            Analysis.completed_at,
            Analysis.failed_at,
            Analysis.attempts,
            Analysis.terminal_outcome,
            Analysis.movement_id,
            Movement.name,
        )
        .outerjoin(Profile, Profile.id == Analysis.user_id)
        .outerjoin(Movement, Movement.id == Analysis.movement_id)
        .where(*conditions)
        .order_by(Analysis.created_at.desc(), Analysis.id.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    return _page(
        [
            {
                "id": aid,
                "user_id": uid,
                "owner_name": name,
                "owner_kind": kind,
                "status": state,
                "stage": stage,
                "created_at": created,
                "completed_at": completed,
                "failed_at": failed,
                "attempts": attempts,
                "terminal_outcome": outcome,
                "movement_id": mid,
                "movement_name": movement_name,
            }
            for aid, uid, name, kind, state, stage, created, completed, failed, attempts, outcome, mid, movement_name in rows
        ],
        total,
        page,
        page_size,
    )


@router.get("/analyses/{analysis_id}")
def get_analysis(analysis_id: uuid.UUID, db: DbSession, _admin: AdminProfile):
    row = db.execute(
        select(Analysis, Profile.display_name, Movement.name)
        .outerjoin(Profile, Profile.id == Analysis.user_id)
        .outerjoin(Movement, Movement.id == Analysis.movement_id)
        .where(Analysis.id == analysis_id)
    ).one_or_none()
    if row is None:
        raise HTTPException(404, "Analysis not found.")
    analysis, owner_name, movement_name = row
    return {
        "id": analysis.id,
        "user_id": analysis.user_id,
        "owner_name": owner_name,
        "owner_kind": analysis.owner_kind,
        "movement_id": analysis.movement_id,
        "movement_name": movement_name,
        "status": analysis.status,
        "stage": analysis.stage,
        "created_at": analysis.created_at,
        "completed_at": analysis.completed_at,
        "failed_at": analysis.failed_at,
        "attempts": analysis.attempts,
        "terminal_outcome": analysis.terminal_outcome,
        "valid_rep_count": analysis.valid_rep_count,
        "partial_rep_count": analysis.partial_rep_count,
        "uncertain_rep_count": analysis.uncertain_rep_count,
        "explanation_status": analysis.ai_feedback_status,
        "failure_detail": _safe_error(analysis.error_code)
        if analysis.status == "failed"
        else None,
    }


@router.get("/usage")
def list_usage(
    db: DbSession,
    _admin: AdminProfile,
    page: int = PageNumber,
    page_size: int = PageSize,
    q: str | None = Query(None, max_length=80),
):
    conditions = [Profile.app_role == "athlete"]
    if q and q.strip():
        escaped = (
            q.strip().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        )
        conditions.append(Profile.display_name.ilike(f"%{escaped}%", escape="\\"))
    total = db.scalar(select(func.count()).select_from(Profile).where(*conditions)) or 0
    profiles = db.execute(
        select(Profile.id, Profile.display_name)
        .where(*conditions)
        .order_by(Profile.created_at.desc(), Profile.id.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).all()
    ids = [uid for uid, _ in profiles]
    now = datetime.now(UTC)
    start, end = calendar_month_window(now)
    usage = _usage_by_user(db, ids, start, end)
    pro_users = effective_pro_user_ids(db, ids, as_of=now)
    return {
        **_page(
            [
                {
                    "user_id": uid,
                    "display_name": name,
                    "effective_plan": "pro" if uid in pro_users else "free",
                    "usage": usage.get(uid, {}),
                }
                for uid, name in profiles
            ],
            total,
            page,
            page_size,
        ),
        "usage_window": {"start": start, "end": end},
    }


@router.get("/plans")
def list_plans(
    db: DbSession,
    _admin: AdminProfile,
    page: int = PageNumber,
    page_size: int = PageSize,
    user_id: uuid.UUID | None = None,
):
    conditions = [TrainingPlan.user_id == user_id] if user_id else []
    total = (
        db.scalar(select(func.count()).select_from(TrainingPlan).where(*conditions))
        or 0
    )
    rows = db.execute(
        select(
            TrainingPlan.id,
            TrainingPlan.user_id,
            Profile.display_name,
            TrainingPlan.title,
            TrainingPlan.saved_at,
        )
        .join(Profile, Profile.id == TrainingPlan.user_id)
        .where(*conditions)
        .order_by(TrainingPlan.saved_at.desc(), TrainingPlan.id.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    return _page(
        [
            {
                "id": pid,
                "user_id": uid,
                "owner_name": name,
                "title": title,
                "saved_at": saved,
            }
            for pid, uid, name, title, saved in rows
        ],
        total,
        page,
        page_size,
    )


@router.get("/plans/{plan_id}")
def get_plan(plan_id: uuid.UUID, db: DbSession, _admin: AdminProfile):
    row = db.execute(
        select(TrainingPlan, Profile.display_name)
        .join(Profile, Profile.id == TrainingPlan.user_id)
        .where(TrainingPlan.id == plan_id)
    ).one_or_none()
    if row is None:
        raise HTTPException(404, "Training plan not found.")
    plan, owner_name = row
    try:
        document = WeeklyPlanCandidate.model_validate(plan.plan_document).model_dump(
            mode="json"
        )
        document_status = "valid"
    except ValidationError:
        document = None
        document_status = "invalid"
    return {
        "id": plan.id,
        "user_id": plan.user_id,
        "owner_name": owner_name,
        "title": plan.title,
        "saved_at": plan.saved_at,
        "document_status": document_status,
        "plan_document": document,
    }
