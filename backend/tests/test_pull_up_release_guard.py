from app.analyzers.common.types import RepPhase
from app.analyzers.pull_up.config import DEFAULT_PULL_UP_CONFIG
from app.analyzers.pull_up.phases import PullUpPhaseTracker


def test_elbow_flexion_without_body_rise_does_not_start_rep() -> None:
    tracker = PullUpPhaseTracker(DEFAULT_PULL_UP_CONFIG)

    tracker.update(
        timestamp_ms=0,
        angle_deg=150.0,
        body_relative_y=0.20,
    )

    tracker.update(
        timestamp_ms=100,
        angle_deg=120.0,
        body_relative_y=0.20,
    )

    assert tracker.phase == RepPhase.BOTTOM

    rep = tracker.interrupt(
        timestamp_ms=200,
        reason_code="wrist_release_detected",
    )

    assert rep is None
    assert tracker.rep_index == 0


def test_elbow_flexion_with_body_rise_starts_rep() -> None:
    tracker = PullUpPhaseTracker(DEFAULT_PULL_UP_CONFIG)

    tracker.update(
        timestamp_ms=0,
        angle_deg=150.0,
        body_relative_y=0.20,
    )

    tracker.update(
        timestamp_ms=100,
        angle_deg=120.0,
        body_relative_y=0.18,
    )

    assert tracker.phase == RepPhase.RISING
