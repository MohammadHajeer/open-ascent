from __future__ import annotations

from dataclasses import asdict, dataclass, field
from enum import StrEnum
from typing import Any


class RepPhase(StrEnum):
    UNKNOWN = "unknown"
    BOTTOM = "bottom"
    RISING = "rising"
    TOP = "top"
    LOWERING = "lowering"


class RepOutcome(StrEnum):
    VALID = "valid"
    PARTIAL = "partial"
    UNCERTAIN = "uncertain"


class AnalysisOutcome(StrEnum):
    COMPLETED = "completed"
    ZERO_VALID_REPS = "zero_valid_reps"
    INSUFFICIENT_EVIDENCE = "insufficient_evidence"


@dataclass(frozen=True, slots=True)
class PhaseEvent:
    phase: RepPhase
    timestamp_ms: int


@dataclass(frozen=True, slots=True)
class RepAnalysis:
    rep_index: int
    outcome: RepOutcome

    start_ms: int
    end_ms: int

    top_ms: int | None = None

    phase_events: list[PhaseEvent] = field(default_factory=list)

    reason_codes: list[str] = field(default_factory=list)

    variations: dict[str, str] = field(default_factory=dict)
    target_match: bool | None = None
    target_deviations: list[dict[str, str]] = field(default_factory=list)


@dataclass(frozen=True, slots=True)
class AnalysisEvidence:
    total_sampled_frames: int
    usable_pose_frames: int
    usable_pose_ratio: float

    hang_confirmed: bool

    reason_codes: list[str] = field(default_factory=list)


@dataclass(frozen=True, slots=True)
class MovementAnalysisResult:
    outcome: AnalysisOutcome

    duration_ms: int

    valid_rep_count: int
    partial_rep_count: int
    uncertain_rep_count: int

    reps: list[RepAnalysis]

    evidence: AnalysisEvidence

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)
