from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict

ProgressMeasurement = Literal["reps", "hold_seconds"]


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ProgressConsistency(StrictModel):
    week_started_at: datetime
    workouts_this_week: int
    active_days_this_week: int
    sets_this_week: int


class ProgressTrendPoint(StrictModel):
    recorded_at: datetime
    value: float
    source: Literal["manual", "self_reported", "uploaded_analysis", "live_coach"]
    intent: Literal["training_set", "assessment", "max_test", "skill_attempt"]
    workout_session_id: uuid.UUID
    workout_set_id: uuid.UUID


class ProgressMetricSeries(StrictModel):
    measurement: ProgressMeasurement
    label: str
    unit: str
    points: list[ProgressTrendPoint]


class ProgressMovement(StrictModel):
    id: uuid.UUID
    name: str
    metrics: list[ProgressMetricSeries]


class ProgressSummary(StrictModel):
    consistency: ProgressConsistency
    movements: list[ProgressMovement]
