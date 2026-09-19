from __future__ import annotations

import math
from collections.abc import Sequence
from dataclasses import dataclass

from app.analyzers.common.geometry import Landmark2D

LEFT_SHOULDER = 11
RIGHT_SHOULDER = 12
LEFT_WRIST = 15
RIGHT_WRIST = 16
LEFT_HIP = 23
RIGHT_HIP = 24


@dataclass(frozen=True, slots=True)
class WristHistorySample:
    left_x: float
    left_y: float
    right_x: float
    right_y: float
    shoulder_relative_y: float


@dataclass(frozen=True, slots=True)
class HangMetrics:
    # Largest raw x/y movement seen across either wrist. This remains
    # useful for diagnostics, but it is intentionally NOT the value used
    # to decide whether the hands are anchored because camera shake moves
    # both wrists together on screen.
    max_wrist_range: float

    # Shoulder movement relative to the wrist midpoint. Translation of the
    # whole camera cancels out here, so this remains useful under jitter.
    body_movement_range: float

    # True when the geometry between the two wrists stays stable enough.
    wrists_stable: bool

    # Range of the left-to-right wrist distance during the evidence window.
    wrist_span_range: float = 0.0


def hands_are_above_shoulders(
    landmarks: Sequence[Landmark2D],
) -> bool:
    left_shoulder = landmarks[LEFT_SHOULDER]
    right_shoulder = landmarks[RIGHT_SHOULDER]

    left_wrist = landmarks[LEFT_WRIST]
    right_wrist = landmarks[RIGHT_WRIST]

    return left_wrist.y < left_shoulder.y and right_wrist.y < right_shoulder.y


def body_is_under_hands(
    landmarks: Sequence[Landmark2D],
    *,
    alignment_tolerance: float,
) -> bool:
    left_shoulder = landmarks[LEFT_SHOULDER]
    right_shoulder = landmarks[RIGHT_SHOULDER]

    left_wrist = landmarks[LEFT_WRIST]
    right_wrist = landmarks[RIGHT_WRIST]

    left_hip = landmarks[LEFT_HIP]
    right_hip = landmarks[RIGHT_HIP]

    wrist_center_x = (left_wrist.x + right_wrist.x) / 2
    wrist_center_y = (left_wrist.y + right_wrist.y) / 2

    shoulder_center_y = (left_shoulder.y + right_shoulder.y) / 2

    hip_center_x = (left_hip.x + right_hip.x) / 2
    hip_center_y = (left_hip.y + right_hip.y) / 2

    vertically_under_hands = wrist_center_y < shoulder_center_y < hip_center_y

    horizontally_aligned = abs(hip_center_x - wrist_center_x) < alignment_tolerance

    return vertically_under_hands and horizontally_aligned


def build_wrist_history_sample(
    landmarks: Sequence[Landmark2D],
) -> WristHistorySample:
    left_shoulder = landmarks[LEFT_SHOULDER]
    right_shoulder = landmarks[RIGHT_SHOULDER]

    left_wrist = landmarks[LEFT_WRIST]
    right_wrist = landmarks[RIGHT_WRIST]

    wrist_center_y = (left_wrist.y + right_wrist.y) / 2
    shoulder_center_y = (left_shoulder.y + right_shoulder.y) / 2

    return WristHistorySample(
        left_x=left_wrist.x,
        left_y=left_wrist.y,
        right_x=right_wrist.x,
        right_y=right_wrist.y,
        shoulder_relative_y=(shoulder_center_y - wrist_center_y),
    )


def calculate_hang_metrics(
    samples: Sequence[WristHistorySample],
    *,
    required_samples: int,
    wrist_stability_threshold: float,
) -> HangMetrics | None:
    if len(samples) < required_samples:
        return None

    wrist_ranges = (
        max(sample.left_x for sample in samples)
        - min(sample.left_x for sample in samples),
        max(sample.left_y for sample in samples)
        - min(sample.left_y for sample in samples),
        max(sample.right_x for sample in samples)
        - min(sample.right_x for sample in samples),
        max(sample.right_y for sample in samples)
        - min(sample.right_y for sample in samples),
    )

    max_wrist_range = max(wrist_ranges)

    # Camera shake is approximately a global image translation. Raw wrist
    # coordinates can therefore move a lot even when both hands remain on
    # the same fixed bar. The distance BETWEEN the wrists is invariant to
    # that translation, so it is a better initial anchor cue.
    wrist_spans = [
        math.hypot(
            sample.right_x - sample.left_x,
            sample.right_y - sample.left_y,
        )
        for sample in samples
    ]

    wrist_span_range = max(wrist_spans) - min(wrist_spans)

    body_movement_range = max(sample.shoulder_relative_y for sample in samples) - min(
        sample.shoulder_relative_y for sample in samples
    )

    return HangMetrics(
        max_wrist_range=max_wrist_range,
        body_movement_range=body_movement_range,
        wrists_stable=(
            wrist_span_range <= wrist_stability_threshold
        ),
        wrist_span_range=wrist_span_range,
    )
