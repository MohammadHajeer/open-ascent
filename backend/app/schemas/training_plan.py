"""Structured model proposal and bounded, authoritative weekly plan document."""

from __future__ import annotations

import uuid
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator


class _Proposal(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ProposedExercise(_Proposal):
    movement_id: str
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


class _Candidate(BaseModel):
    model_config = ConfigDict(extra="forbid")


class PlanExercise(_Candidate):
    movement_id: uuid.UUID
    sets: int = Field(strict=True, ge=1, le=10)
    reps: int | None = Field(default=None, strict=True, ge=1, le=100)
    hold_seconds: int | None = Field(default=None, strict=True, ge=1, le=600)
    rest_seconds: int = Field(strict=True, ge=0, le=600)
    notes: Notes | None = None

    @model_validator(mode="after")
    def exactly_one_target(self) -> PlanExercise:
        if (self.reps is None) == (self.hold_seconds is None):
            raise ValueError("Exactly one repetition or hold target is required.")
        return self


class PlanDay(_Candidate):
    day_index: int = Field(strict=True, ge=1, le=7)
    label: ShortText | None = None
    exercises: list[PlanExercise] = Field(min_length=1, max_length=8)


class WeeklyPlanCandidate(_Candidate):
    title: Title
    summary: Summary | None = None
    days: list[PlanDay] = Field(min_length=1, max_length=7)

    @model_validator(mode="after")
    def weekly_shape(self) -> WeeklyPlanCandidate:
        indices = [day.day_index for day in self.days]
        if indices != sorted(set(indices)):
            raise ValueError("Plan days must be unique and in order.")
        if sum(len(day.exercises) for day in self.days) > 24:
            raise ValueError("A weekly plan can contain at most 24 exercises.")
        return self
