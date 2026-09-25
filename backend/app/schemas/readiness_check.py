"""Bounded athlete answers to current published foundation rules."""

from __future__ import annotations

import uuid
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


class ReadinessAnswer(BaseModel):
    model_config = ConfigDict(extra="forbid")

    movement_id: uuid.UUID
    documentation_id: uuid.UUID
    rule_code: str = Field(pattern=r"^[a-z][a-z0-9_]{2,63}$")
    response: Literal["able", "not_yet", "avoid"]


class ReadinessAnswersInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    answers: list[ReadinessAnswer] = Field(min_length=1, max_length=3)

    @model_validator(mode="after")
    def no_duplicates(self) -> ReadinessAnswersInput:
        keys = [(item.movement_id, item.rule_code) for item in self.answers]
        if len(keys) != len(set(keys)):
            raise ValueError("Answer each readiness question once.")
        return self
