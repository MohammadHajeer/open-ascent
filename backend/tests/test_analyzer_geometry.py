from dataclasses import dataclass

import pytest

from app.analyzers.common.geometry import calculate_angle


@dataclass
class Point:
    x: float
    y: float


def test_calculate_straight_angle() -> None:
    angle = calculate_angle(
        Point(0.0, 0.0),
        Point(1.0, 0.0),
        Point(2.0, 0.0),
    )

    assert angle == pytest.approx(180.0)


def test_calculate_right_angle() -> None:
    angle = calculate_angle(
        Point(1.0, 0.0),
        Point(0.0, 0.0),
        Point(0.0, 1.0),
    )

    assert angle == pytest.approx(90.0)


def test_calculate_zero_length_vector_returns_none() -> None:
    angle = calculate_angle(
        Point(0.0, 0.0),
        Point(0.0, 0.0),
        Point(1.0, 0.0),
    )

    assert angle is None
