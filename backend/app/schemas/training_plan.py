"""Structured model proposal and bounded, authoritative weekly plan document."""

from __future__ import annotations

import uuid
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator


class _Proposal(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ProposedExercise(_Proposal):
    # Copied from the allowed exercise pool; the server resolves its identity.
    exercise_id: str
    sets: int
    reps: int | None
    hold_seconds: int | None
    rest_seconds: int
    notes: str | None


class ProposedDay(_Proposal):
    day_index: int
    label: str | None
    exercises: list[ProposedExercise]


class WeeklyPlanProposal(_Proposal):
    """Provider-facing schema; application constraints run on the candidate."""

    title: str
    summary: str | None
    days: list[ProposedDay]


Title = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)]
Summary = Annotated[str, StringConstraints(strip_whitespace=True, max_length=500)]
ShortText = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=80)]
Notes = Annotated[str, StringConstraints(strip_whitespace=True, max_length=280)]
SupportingKey = Annotated[str, StringConstraints(pattern=r"^[a-z][a-z0-9-]{1,63}$")]
PathKey = Annotated[str, StringConstraints(pattern=r"^[a-z][a-z0-9-]{1,39}$")]
# Version 1 documents reference canonical movements only. Version 2 adds
# curated supporting exercises, the training path, and server explanations.
CURRENT_SCHEMA_VERSION = 2


class _Candidate(BaseModel):
    model_config = ConfigDict(extra="forbid")


class PlanExercise(_Candidate):
    movement_id: uuid.UUID | None = None
    supporting_exercise_id: SupportingKey | None = None
    sets: int = Field(strict=True, ge=1, le=10)
    reps: int | None = Field(default=None, strict=True, ge=1, le=100)
    hold_seconds: int | None = Field(default=None, strict=True, ge=1, le=600)
    rest_seconds: int = Field(strict=True, ge=0, le=600)
    notes: Notes | None = None
    # Written by the server from deterministic evidence, never by the model.
    explanation: Notes | None = None

    @model_validator(mode="after")
    def exactly_one_target(self) -> PlanExercise:
        if (self.reps is None) == (self.hold_seconds is None):
            raise ValueError("Exactly one repetition or hold target is required.")
        if (self.movement_id is None) == (self.supporting_exercise_id is None):
            raise ValueError("Exactly one movement or supporting exercise is required.")
        return self

    @property
    def identity(self) -> str:
        return str(self.movement_id) if self.movement_id else str(self.supporting_exercise_id)


class PlanDay(_Candidate):
    day_index: int = Field(strict=True, ge=1, le=7)
    label: ShortText | None = None
    exercises: list[PlanExercise] = Field(min_length=1, max_length=8)


class PlanOrigin(_Candidate):
    mode: Literal["profile", "goal", "progress"]
    goal_name: ShortText | None = None
    based_on: list[ShortText] = Field(min_length=1, max_length=5)
    note: Notes | None = None


class WeeklyPlanCandidate(_Candidate):
    schema_version: Literal[1, 2] = 1
    title: Title
    summary: Summary | None = None
    days: list[PlanDay] = Field(min_length=1, max_length=7)
    origin: PlanOrigin | None = None
    provisional_readiness: bool = False
    path_key: PathKey | None = None
    goal_slug: PathKey | None = None
    catalog_version: int | None = Field(default=None, ge=1)

    @model_validator(mode="after")
    def weekly_shape(self) -> WeeklyPlanCandidate:
        exercises = [exercise for day in self.days for exercise in day.exercises]
        if self.schema_version == 1 and (
            self.path_key or self.catalog_version
            or any(exercise.supporting_exercise_id or exercise.explanation for exercise in exercises)
        ):
            raise ValueError("Version 1 plans reference canonical movements only.")
        if self.schema_version == 2 and not self.path_key:
            raise ValueError("A version 2 plan records its training path.")
        indices = [day.day_index for day in self.days]
        if indices != sorted(set(indices)):
            raise ValueError("Plan days must be unique and in order.")
        if sum(len(day.exercises) for day in self.days) > 24:
            raise ValueError("A weekly plan can contain at most 24 exercises.")
        return self
