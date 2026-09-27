"""Strict model-facing arguments for the eight read-only Coach tools."""

from __future__ import annotations

import uuid
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, field_validator

MovementText = Annotated[str, StringConstraints(min_length=1, max_length=80)]
ToolLimit = Annotated[int, Field(strict=True, ge=1, le=10)]


class ToolArguments(BaseModel):
    model_config = ConfigDict(extra="forbid")

    @field_validator("movement", "query", "exercise", check_fields=False, mode="before")
    @classmethod
    def normalize_text(cls, value: object) -> object:
        return " ".join(value.split()) if isinstance(value, str) else value


class ProfileArguments(ToolArguments):
    pass


class RecentWorkoutsArguments(ToolArguments):
    movement: MovementText | None = None
    limit: ToolLimit = 5


class ProgressArguments(ToolArguments):
    movement: MovementText | None = None


class RecentAnalysesArguments(ToolArguments):
    movement: MovementText | None = None
    limit: ToolLimit = 5


class AnalysisDetailArguments(ToolArguments):
    analysis_id: uuid.UUID


class MovementGuideArguments(ToolArguments):
    movement: MovementText


class SearchMovementsArguments(ToolArguments):
    query: MovementText
    limit: ToolLimit = 5


class SupportingExerciseArguments(ToolArguments):
    exercise: MovementText
