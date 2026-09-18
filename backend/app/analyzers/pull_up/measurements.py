from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from typing import Protocol

from app.analyzers.common.geometry import calculate_angle

LEFT_SHOULDER = 11
RIGHT_SHOULDER = 12

LEFT_ELBOW = 13
RIGHT_ELBOW = 14

LEFT_WRIST = 15
RIGHT_WRIST = 16

LEFT_HIP = 23
RIGHT_HIP = 24


class PoseLandmark(Protocol):
    x: float
    y: float
    visibility: float


@dataclass(frozen=True, slots=True)
class PullUpFrameMeasurement:
    timestamp_ms: int

    left_elbow_angle_deg: float
    right_elbow_angle_deg: float
    average_elbow_angle_deg: float

    minimum_required_visibility: float


REQUIRED_LANDMARK_INDEXES = (
    LEFT_SHOULDER,
    RIGHT_SHOULDER,
    LEFT_ELBOW,
    RIGHT_ELBOW,
    LEFT_WRIST,
    RIGHT_WRIST,
    LEFT_HIP,
    RIGHT_HIP,
)


def measure_pull_up_frame(
    landmarks: Sequence[PoseLandmark],
    *,
    timestamp_ms: int,
    min_visibility: float,
) -> PullUpFrameMeasurement | None:
    """
    Convert one pose-landmark frame into the measurements needed
    by the pull-up analyzer.

    Returns None when the required body landmarks are not reliable
    enough to use.
    """

    if len(landmarks) <= max(REQUIRED_LANDMARK_INDEXES):
        return None

    minimum_visibility = min(
        landmarks[index].visibility for index in REQUIRED_LANDMARK_INDEXES
    )

    if minimum_visibility < min_visibility:
        return None

    left_angle = calculate_angle(
        landmarks[LEFT_SHOULDER],
        landmarks[LEFT_ELBOW],
        landmarks[LEFT_WRIST],
    )

    right_angle = calculate_angle(
        landmarks[RIGHT_SHOULDER],
        landmarks[RIGHT_ELBOW],
        landmarks[RIGHT_WRIST],
    )

    if left_angle is None or right_angle is None:
        return None

    return PullUpFrameMeasurement(
        timestamp_ms=timestamp_ms,
        left_elbow_angle_deg=left_angle,
        right_elbow_angle_deg=right_angle,
        average_elbow_angle_deg=(left_angle + right_angle) / 2,
        minimum_required_visibility=minimum_visibility,
    )
