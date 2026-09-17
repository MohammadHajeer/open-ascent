from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

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
