from __future__ import annotations

from enum import StrEnum
from typing import Literal

from pydantic import BaseModel, Field


class ReadinessStatus(StrEnum):
    PASS = "pass"
    FAIL = "fail"
    UNKNOWN = "unknown"


class ReadinessEvidence(BaseModel):
    requirement: str
    satisfied: bool | None = None


class ReadinessResult(BaseModel):
    status: ReadinessStatus

    failed_requirements: list[str] = Field(default_factory=list)
    missing_evidence: list[str] = Field(default_factory=list)

    prescription_allowed: bool
    easier_option: str | None = None

    retrospective_analysis_allowed: Literal[True] = True
