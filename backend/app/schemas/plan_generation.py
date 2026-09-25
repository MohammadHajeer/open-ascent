"""Explicit, owner-scoped Library plan request."""

from __future__ import annotations

import uuid
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


class LibraryPlanRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    client_request_id: uuid.UUID
    mode: Literal["profile", "goal", "progress"]
    goal_movement_id: uuid.UUID | None = None
    goal_focus: Literal["general_pulling_strength"] | None = None
    note: str | None = Field(default=None, max_length=280)

    @model_validator(mode="after")
    def goal_only_in_goal_mode(self) -> LibraryPlanRequest:
        if self.mode == "goal" and (self.goal_movement_id is None) == (self.goal_focus is None):
            raise ValueError("Select one supported goal.")
        if self.mode != "goal" and (self.goal_movement_id or self.goal_focus):
            raise ValueError("A goal is only valid in goal mode.")
        if self.note is not None:
            self.note = " ".join(self.note.split()) or None
        return self
