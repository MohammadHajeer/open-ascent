"""Durable retry cache for successful visual-classification calls."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.ai_run import AIRun
from app.services.vertical_pull_visual_classifier import (
    VISUAL_CLASSIFIER_VERSION,
    VisualClassifierCall,
    VisualRepResult,
)

FEATURE = "vertical_pull_visual_classification"
PROVIDER = "openai"


def visual_operation_key(
    analysis_id: uuid.UUID,
    rep_index: int,
    dimensions: tuple[str, ...],
) -> str:
    requested = ",".join(dimensions)
    return (
        f"{VISUAL_CLASSIFIER_VERSION}:{analysis_id}:rep:{rep_index}:"
        f"dimensions:{requested}"
    )


def load_cached_visual_result(
    db: Session,
    *,
    operation_key: str,
    rep_index: int,
    dimensions: tuple[str, ...],
) -> VisualRepResult | None:
    run = db.scalar(select(AIRun).where(AIRun.operation_key == operation_key))
    if (
        run is None
        or run.status != "completed"
        or not isinstance(run.temporary_result, dict)
        or run.result_expires_at is None
        or run.result_expires_at <= datetime.now(UTC)
    ):
        return None
    result = VisualRepResult.model_validate(run.temporary_result)
    if result.rep_index != rep_index or tuple(result.classifications) != dimensions:
        raise ValueError("Cached visual classification does not match the request.")
    return result


def persist_visual_success(
    db: Session,
    *,
    analysis_id: uuid.UUID,
    operation_key: str,
    dimensions: tuple[str, ...],
    call: VisualClassifierCall,
) -> None:
    run = db.scalar(
        select(AIRun).where(AIRun.operation_key == operation_key).with_for_update()
    )
    values = {
        "analysis_id": analysis_id,
        "feature": FEATURE,
        "provider": PROVIDER,
        "model": settings.openai_visual_classifier_model,
        "status": "completed",
        "reserved_cost": Decimal(0),
        "actual_cost": None,
        "usage": call.usage,
        "metadata_json": {
            "classifier_version": VISUAL_CLASSIFIER_VERSION,
            "rep_index": call.result.rep_index,
            "dimensions": list(dimensions),
        },
        "temporary_result": call.result.model_dump(mode="json"),
        "result_expires_at": datetime.now(UTC)
        + timedelta(hours=settings.guest_purge_ttl_hours),
    }
    if run is None:
        db.add(AIRun(operation_key=operation_key, **values))
    else:
        for name, value in values.items():
            setattr(run, name, value)
    db.commit()
