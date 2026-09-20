from __future__ import annotations

import uuid
from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, field_validator
from pydantic_core import PydanticCustomError

DisplayName = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=2, max_length=80)
]
Goal = Literal["strength", "skill", "technique", "consistency"]
Equipment = Literal["pull_up_bar", "dip_bars", "rings", "none", "unknown"]
Stage = Literal["new", "building", "established", "unknown"]
Experience = Literal["new", "some", "regular", "unknown"]
SkillStage = Literal["not_started", "practicing", "achieved", "unknown"]
RepCount = Annotated[int, Field(ge=0, le=500)]


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class AvailabilityInput(StrictModel):
    days_per_week: Annotated[int, Field(ge=1, le=7)] | None
    minutes_per_session: Annotated[int, Field(ge=15, le=180)] | None


class CoachingContextInput(StrictModel):
    primary_goal: Goal
    equipment: list[Equipment] = Field(min_length=1, max_length=4)
    availability: AvailabilityInput
    avoid_movement_ids: list[uuid.UUID] = Field(default_factory=list, max_length=12)

    @field_validator("equipment")
    @classmethod
    def validate_equipment(cls, value: list[Equipment]) -> list[Equipment]:
        if len(value) != len(set(value)):
            raise PydanticCustomError("duplicate_equipment", "Equipment choices must be unique.")
        if len(value) > 1 and ({"none", "unknown"} & set(value)):
            raise PydanticCustomError(
                "mixed_equipment", "None and unknown cannot be combined with equipment."
            )
        return value

    @field_validator("avoid_movement_ids")
    @classmethod
    def validate_avoidances(cls, value: list[uuid.UUID]) -> list[uuid.UUID]:
        if len(value) != len(set(value)):
            raise PydanticCustomError("duplicate_movement", "Movement choices must be unique.")
        return value


class RepCounts(StrictModel):
    pull_up: RepCount | None
    push_up: RepCount | None
    dips: RepCount | None


class DimensionStages(StrictModel):
    pulling: Stage
    pushing: Stage
    core: Stage
    balance: Stage
    statics: Stage


class SkillProgressionInput(StrictModel):
    movement_id: uuid.UUID
    stage: SkillStage


class AssessmentAnswers(StrictModel):
    training_experience: Experience
    max_clean_reps: RepCounts
    dimension_stage: DimensionStages
    skill_progression: SkillProgressionInput | None = None


class SafetyAcknowledgementInput(StrictModel):
    version: str
    acknowledged: Literal[True]


class OnboardingSubmit(StrictModel):
    display_name: DisplayName
    coaching_context: CoachingContextInput
    assessment: AssessmentAnswers
    safety: SafetyAcknowledgementInput


class CatalogMovement(StrictModel):
    id: uuid.UUID
    name: str


class OnboardingConfig(StrictModel):
    safety_version: str
    safety_guidance: tuple[str, ...]
    skill_movements: list[CatalogMovement]
    avoidance_movements: list[CatalogMovement]


class OnboardingResult(StrictModel):
    display_name: str
    onboarding_completed_at: datetime
