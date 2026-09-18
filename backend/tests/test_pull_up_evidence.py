from dataclasses import dataclass

from app.analyzers.pull_up.evidence import (
    WristHistorySample,
    body_is_under_hands,
    calculate_hang_metrics,
    hands_are_above_shoulders,
)


@dataclass
class Point:
    x: float
    y: float


def make_landmarks() -> list[Point]:
    landmarks = [Point(x=0.5, y=0.5) for _ in range(33)]

    landmarks[11] = Point(0.40, 0.35)
    landmarks[12] = Point(0.60, 0.35)

    landmarks[15] = Point(0.40, 0.20)
    landmarks[16] = Point(0.60, 0.20)

    landmarks[23] = Point(0.45, 0.60)
    landmarks[24] = Point(0.55, 0.60)

    return landmarks


def test_hands_are_above_shoulders() -> None:
    landmarks = make_landmarks()

    assert hands_are_above_shoulders(landmarks)


def test_hands_below_shoulders_are_rejected() -> None:
    landmarks = make_landmarks()

    landmarks[15] = Point(0.40, 0.50)

    assert not hands_are_above_shoulders(landmarks)


def test_body_is_under_hands() -> None:
    landmarks = make_landmarks()

    assert body_is_under_hands(
        landmarks,
        alignment_tolerance=0.15,
    )


def test_body_far_from_hands_is_rejected() -> None:
    landmarks = make_landmarks()

    landmarks[23] = Point(0.80, 0.60)
    landmarks[24] = Point(0.90, 0.60)

    assert not body_is_under_hands(
        landmarks,
        alignment_tolerance=0.15,
    )


def test_stable_wrists_produce_stable_hang_metrics() -> None:
    samples = [
        WristHistorySample(
            left_x=0.40 + (index * 0.001),
            left_y=0.20,
            right_x=0.60 + (index * 0.001),
            right_y=0.20,
            shoulder_relative_y=0.10 + (index * 0.002),
        )
        for index in range(5)
    ]

    metrics = calculate_hang_metrics(
        samples,
        required_samples=5,
        wrist_stability_threshold=0.025,
    )

    assert metrics is not None
    assert metrics.wrists_stable
    assert metrics.body_movement_range > 0


def test_not_enough_samples_returns_none() -> None:
    samples = [
        WristHistorySample(
            left_x=0.40,
            left_y=0.20,
            right_x=0.60,
            right_y=0.20,
            shoulder_relative_y=0.10,
        )
    ]

    metrics = calculate_hang_metrics(
        samples,
        required_samples=5,
        wrist_stability_threshold=0.025,
    )

    assert metrics is None
