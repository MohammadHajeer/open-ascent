from __future__ import annotations

from pydantic import BaseModel, ConfigDict


class GroundedText(BaseModel):
    model_config = ConfigDict(extra="forbid")

    text: str
    evidence: list[str]


class AnalysisExplanation(BaseModel):
    model_config = ConfigDict(extra="forbid")

    summary: GroundedText
    key_findings: list[GroundedText]
    next_set_focus: GroundedText
    safety_note: GroundedText | None
