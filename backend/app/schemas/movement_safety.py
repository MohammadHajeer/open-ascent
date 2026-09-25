from __future__ import annotations

import uuid
from decimal import Decimal
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator

SafetyText = Annotated[
    str,
    StringConstraints(
        strip_whitespace=True,
        min_length=1,
    ),
]

Difficulty = Literal[
    "beginner",
    "intermediate",
    "advanced",
]

ReadinessSource = Literal[
    "uploaded_analysis",
    "live_coach",
    "manual",
    "self_reported",
    "initial_assessment",
    "structured_self_report",
]


class MovementPerformanceRule(BaseModel):
    """An editor-asserted, complete mapping for one documented prerequisite."""

    model_config = ConfigDict(extra="forbid")

    code: Annotated[
        str, StringConstraints(pattern=r"^[a-z][a-z0-9_]{2,63}$")
    ]
    type: Literal["movement_performance"]
    prerequisite_index: int = Field(ge=0, le=31)
    movement_id: uuid.UUID
    metric: Literal["reps", "hold_seconds"]
    operator: Literal[">="]
    value: Decimal = Field(gt=0, le=86400, max_digits=10, decimal_places=3)
    max_age_days: int = Field(ge=1, le=365)
    accepted_sources: list[ReadinessSource] = Field(min_length=1, max_length=6)

    @model_validator(mode="after")
    def distinct_sources(self) -> MovementPerformanceRule:
        if len(self.accepted_sources) != len(set(self.accepted_sources)):
            raise ValueError("Accepted evidence sources must be distinct.")
        if self.metric == "reps" and self.value != self.value.to_integral_value():
            raise ValueError("A repetition threshold must be a whole number.")
        if self.metric == "reps" and self.value > 10000:
            raise ValueError("A repetition threshold exceeds the workout domain.")
        return self


def _validate_rules(
    prerequisites: list[SafetyText], rules: list[MovementPerformanceRule] | None
) -> None:
    if not rules:
        return
    codes = [rule.code for rule in rules]
    indices = [rule.prerequisite_index for rule in rules]
    if len(codes) != len(set(codes)):
        raise ValueError("Readiness rule codes must be unique.")
    if len(indices) != len(set(indices)):
        raise ValueError("Each prerequisite can have only one structured rule.")
    if any(index >= len(prerequisites) for index in indices):
        raise ValueError("Readiness rules must map to a documented prerequisite.")


class MovementSafetyContentDraft(BaseModel):
    model_config = ConfigDict(extra="forbid")

    notice: SafetyText | None = None
    difficulty: Difficulty | None = None
    stressed_areas: list[SafetyText] | None = None
    prerequisites: list[SafetyText] | None = None
    cautions: list[SafetyText] | None = None
    stop_conditions: list[SafetyText] | None = None
    easier_option: SafetyText | None = None
    setup: list[SafetyText] | None = None
    readiness_rules: list[MovementPerformanceRule] | None = Field(default=None, max_length=32)

    @model_validator(mode="after")
    def valid_rules(self) -> MovementSafetyContentDraft:
        if self.prerequisites is not None:
            _validate_rules(self.prerequisites, self.readiness_rules)
        return self


class MovementSafetyContent(BaseModel):
    model_config = ConfigDict(extra="forbid")

    notice: SafetyText
    difficulty: Difficulty

    stressed_areas: list[SafetyText] = Field(min_length=1)
    prerequisites: list[SafetyText]
    cautions: list[SafetyText]
    stop_conditions: list[SafetyText] = Field(min_length=1)

    easier_option: SafetyText | None = None
    setup: list[SafetyText] | None = None
    readiness_rules: list[MovementPerformanceRule] | None = Field(default=None, max_length=32)

    @model_validator(mode="after")
    def valid_rules(self) -> MovementSafetyContent:
        _validate_rules(self.prerequisites, self.readiness_rules)
        return self
