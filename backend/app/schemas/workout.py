from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator

WorkoutSource = Literal["manual", "self_reported", "uploaded_analysis", "live_coach"]
WorkoutPerformer = Literal["self", "other", "unknown"]
WorkoutIntent = Literal["training_set", "assessment", "max_test", "skill_attempt"]
Notes = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=2000)]
LiveCoachRef = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class WorkoutSessionCreate(StrictModel):
    source: WorkoutSource = "manual"
    started_at: datetime | None = None
    notes: Notes | None = None


class WorkoutSessionFinish(StrictModel):
    completed_at: datetime | None = None
    notes: Notes | None = None


class WorkoutSetCreate(StrictModel):
    movement_id: uuid.UUID
    position: Annotated[int, Field(ge=0)]
    source: WorkoutSource = "manual"
    performer: WorkoutPerformer = "self"
    intent: WorkoutIntent = "training_set"
    reps: Annotated[int, Field(gt=0, le=10000)] | None = None
    hold_seconds: Annotated[Decimal, Field(gt=0, le=86400, max_digits=10, decimal_places=3)] | None = None
    analysis_id: uuid.UUID | None = None
    live_coach_session_ref: LiveCoachRef | None = None

    @model_validator(mode="after")
    def validate_shape(self) -> WorkoutSetCreate:
        if (self.reps is None) == (self.hold_seconds is None):
            raise ValueError("Provide exactly one of reps or hold_seconds.")
        if self.source == "uploaded_analysis" and self.analysis_id is None:
            raise ValueError("uploaded_analysis sets require analysis_id.")
        if self.source != "uploaded_analysis" and self.analysis_id is not None:
            raise ValueError("analysis_id is only valid for uploaded_analysis sets.")
        if self.source != "live_coach" and self.live_coach_session_ref is not None:
            raise ValueError("live_coach_session_ref is only valid for live_coach sets.")
        return self


class WorkoutSetUpdate(StrictModel):
    position: Annotated[int, Field(ge=0)] | None = None
    source: WorkoutSource | None = None
    performer: WorkoutPerformer | None = None
    intent: WorkoutIntent | None = None
    reps: Annotated[int, Field(gt=0, le=10000)] | None = None
    hold_seconds: Annotated[Decimal, Field(gt=0, le=86400, max_digits=10, decimal_places=3)] | None = None
    analysis_id: uuid.UUID | None = None
    live_coach_session_ref: LiveCoachRef | None = None


class WorkoutSetRead(StrictModel):
    id: uuid.UUID
    session_id: uuid.UUID
    movement_id: uuid.UUID
    movement_name: str
    position: int
    source: WorkoutSource
    performer: WorkoutPerformer
    intent: WorkoutIntent
    reps: int | None
    hold_seconds: Decimal | None
    analysis_id: uuid.UUID | None
    live_coach_session_ref: str | None
    created_at: datetime
    updated_at: datetime


class WorkoutSessionRead(StrictModel):
    id: uuid.UUID
    source: WorkoutSource
    started_at: datetime
    completed_at: datetime | None
    notes: str | None
    created_at: datetime
    updated_at: datetime


class WorkoutSessionDetail(WorkoutSessionRead):
    sets: list[WorkoutSetRead]
