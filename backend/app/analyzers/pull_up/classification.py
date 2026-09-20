"""Conservative, per-rep pose variation evidence (version 1).

These thresholds do not participate in counting or validity decisions.
"""

from __future__ import annotations

from collections import Counter
from collections.abc import Sequence
from dataclasses import dataclass, replace

from app.analyzers.common.types import RepAnalysis
from app.analyzers.pull_up.config import PullUpAnalyzerConfig
from app.analyzers.pull_up.measurements import (
    LEFT_SHOULDER,
    LEFT_WRIST,
    RIGHT_SHOULDER,
    RIGHT_WRIST,
    PoseLandmark,
    PullUpFrameMeasurement,
)


@dataclass(frozen=True, slots=True)
class VariationObservation:
    timestamp_ms: int
    width: str
    height: str


def observe_variation(
    landmarks: Sequence[PoseLandmark],
    measurement: PullUpFrameMeasurement,
    *,
    config: PullUpAnalyzerConfig,
) -> VariationObservation:
    shoulders = abs(landmarks[RIGHT_SHOULDER].x - landmarks[LEFT_SHOULDER].x)
    wrists = abs(landmarks[RIGHT_WRIST].x - landmarks[LEFT_WRIST].x)
    width = "uncertain"
    height = "uncertain"
    if shoulders > 0.06 and wrists > 0.02:
        ratio = wrists / shoulders
        if ratio <= config.close_wrist_shoulder_ratio:
            width = "close"
        elif ratio >= config.wide_wrist_shoulder_ratio:
            width = "wide"
        elif 1.0 <= ratio <= 1.4:
            width = "standard"

        # A visible face above the wrist/bar line establishes a top. Shoulder
        # proximity then distinguishes clearly high from clearly standard;
        # the gap between thresholds remains uncertain.
        if measurement.face_to_wrist_y is not None and measurement.face_to_wrist_y <= 0:
            shoulder_y = (landmarks[LEFT_SHOULDER].y + landmarks[RIGHT_SHOULDER].y) / 2
            wrist_y = (landmarks[LEFT_WRIST].y + landmarks[RIGHT_WRIST].y) / 2
            distance = (shoulder_y - wrist_y) / shoulders
            if 0 <= distance <= config.high_shoulder_bar_ratio:
                height = "high"
            elif distance >= config.standard_shoulder_bar_ratio:
                height = "standard"
    return VariationObservation(measurement.timestamp_ms, width, height)


def _vote(values: list[str], *, minimum: int, majority: float) -> str:
    usable = [value for value in values if value != "uncertain"]
    if len(usable) < minimum:
        return "uncertain"
    winner, count = Counter(usable).most_common(1)[0]
    return winner if count / len(usable) >= majority else "uncertain"


def add_pose_variations(
    rep: RepAnalysis,
    observations: Sequence[VariationObservation],
    *,
    config: PullUpAnalyzerConfig,
) -> RepAnalysis:
    own = [
        item for item in observations if rep.start_ms <= item.timestamp_ms <= rep.end_ms
    ]
    # A height decision belongs to the rep's ascent/top, not its next hang.
    ascent = [
        item
        for item in own
        if rep.top_ms is not None and item.timestamp_ms <= rep.top_ms
    ]
    return replace(
        rep,
        variations={
            **rep.variations,
            "base_movement": rep.variations.get("movement", "uncertain"),
            "grip_width": _vote(
                [item.width for item in own],
                minimum=config.min_rep_width_samples,
                majority=config.width_majority_ratio,
            ),
            "pull_height": _vote(
                [item.height for item in ascent],
                minimum=config.min_rep_height_samples,
                majority=config.width_majority_ratio,
            ),
        },
    )
