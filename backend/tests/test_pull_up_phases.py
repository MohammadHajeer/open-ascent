from app.analyzers.common.types import (
    RepOutcome,
    RepPhase,
)
from app.analyzers.pull_up.config import (
    DEFAULT_PULL_UP_CONFIG,
)
from app.analyzers.pull_up.phases import PullUpPhaseTracker


def test_full_pull_up_produces_valid_rep() -> None:
    tracker = PullUpPhaseTracker(DEFAULT_PULL_UP_CONFIG)

    assert (
        tracker.update(
            timestamp_ms=0,
            angle_deg=150,
        )
        is None
    )

    assert (
        tracker.update(
            timestamp_ms=100,
            angle_deg=130,
        )
        is None
    )

    assert (
        tracker.update(
            timestamp_ms=200,
            angle_deg=45,
        )
        is None
    )

    assert (
        tracker.update(
            timestamp_ms=300,
            angle_deg=80,
        )
        is None
    )

    rep = tracker.update(
        timestamp_ms=400,
        angle_deg=150,
    )

    assert rep is not None
    assert rep.outcome == RepOutcome.VALID
    assert rep.start_ms == 0
    assert rep.top_ms == 200
    assert rep.end_ms == 400

    assert [event.phase for event in rep.phase_events] == [
        RepPhase.BOTTOM,
        RepPhase.RISING,
        RepPhase.TOP,
        RepPhase.LOWERING,
        RepPhase.BOTTOM,
    ]


def test_incomplete_pull_up_can_be_partial() -> None:
    tracker = PullUpPhaseTracker(DEFAULT_PULL_UP_CONFIG)

    tracker.update(
        timestamp_ms=0,
        angle_deg=150,
    )

    tracker.update(
        timestamp_ms=100,
        angle_deg=130,
    )

    tracker.update(
        timestamp_ms=200,
        angle_deg=80,
    )

    rep = tracker.update(
        timestamp_ms=300,
        angle_deg=150,
    )

    assert rep is not None
    assert rep.outcome == RepOutcome.PARTIAL
    assert rep.top_ms is None
    assert "did_not_reach_top" in rep.reason_codes


def test_small_bottom_movement_is_not_a_rep() -> None:
    tracker = PullUpPhaseTracker(DEFAULT_PULL_UP_CONFIG)

    tracker.update(
        timestamp_ms=0,
        angle_deg=150,
    )

    tracker.update(
        timestamp_ms=100,
        angle_deg=130,
    )

    tracker.update(
        timestamp_ms=200,
        angle_deg=120,
    )

    rep = tracker.update(
        timestamp_ms=300,
        angle_deg=150,
    )

    assert rep is None
    assert tracker.rep_index == 0


def test_tracking_loss_during_rep_produces_uncertain_rep() -> None:
    tracker = PullUpPhaseTracker(DEFAULT_PULL_UP_CONFIG)

    tracker.update(
        timestamp_ms=0,
        angle_deg=150,
    )

    tracker.update(
        timestamp_ms=100,
        angle_deg=120,
    )

    rep = tracker.interrupt(
        timestamp_ms=200,
        reason_code="tracking_lost",
    )

    assert rep is not None
    assert rep.outcome == RepOutcome.UNCERTAIN
    assert "tracking_lost" in rep.reason_codes


def test_tracking_loss_at_bottom_does_not_create_rep() -> None:
    tracker = PullUpPhaseTracker(DEFAULT_PULL_UP_CONFIG)

    tracker.update(
        timestamp_ms=0,
        angle_deg=150,
    )

    rep = tracker.interrupt(
        timestamp_ms=100,
        reason_code="tracking_lost",
    )

    assert rep is None
    assert tracker.rep_index == 0
