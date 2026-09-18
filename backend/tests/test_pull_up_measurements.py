from dataclasses import dataclass

import pytest

from app.analyzers.pull_up.measurements import (
    measure_pull_up_frame,
)


@dataclass
class Landmark:
    x: float
    y: float
    visibility: float = 1.0


def make_landmarks() -> list[Landmark]:
    landmarks = [
        Landmark(
            x=0.5,
            y=0.5,
            visibility=1.0,
        )
        for _ in range(33)
    ]

    # Left arm: straight line.
    landmarks[11] = Landmark(0.30, 0.50)
    landmarks[13] = Landmark(0.40, 0.50)
    landmarks[15] = Landmark(0.50, 0.50)

    # Right arm: straight line.
    landmarks[12] = Landmark(0.70, 0.50)
    landmarks[14] = Landmark(0.60, 0.50)
    landmarks[16] = Landmark(0.50, 0.50)

    landmarks[23] = Landmark(0.40, 0.70)
    landmarks[24] = Landmark(0.60, 0.70)

    return landmarks


def test_measure_valid_pull_up_frame() -> None:
    measurement = measure_pull_up_frame(
        make_landmarks(),
        timestamp_ms=1000,
        min_visibility=0.50,
    )

    assert measurement is not None

    assert measurement.timestamp_ms == 1000

    assert measurement.left_elbow_angle_deg == pytest.approx(180.0)

    assert measurement.right_elbow_angle_deg == pytest.approx(180.0)

    assert measurement.average_elbow_angle_deg == pytest.approx(180.0)


def test_low_visibility_frame_is_rejected() -> None:
    landmarks = make_landmarks()

    landmarks[15].visibility = 0.20

    measurement = measure_pull_up_frame(
        landmarks,
        timestamp_ms=1000,
        min_visibility=0.50,
    )

    assert measurement is None


def test_missing_required_landmarks_are_rejected() -> None:
    landmarks = make_landmarks()[:10]

    measurement = measure_pull_up_frame(
        landmarks,
        timestamp_ms=1000,
        min_visibility=0.50,
    )

    assert measurement is None


def test_degenerate_elbow_geometry_is_rejected() -> None:
    landmarks = make_landmarks()

    landmarks[11] = Landmark(0.40, 0.50)
    landmarks[13] = Landmark(0.40, 0.50)

    measurement = measure_pull_up_frame(
        landmarks,
        timestamp_ms=1000,
        min_visibility=0.50,
    )

    assert measurement is None
