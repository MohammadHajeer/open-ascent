from __future__ import annotations

from app.analyzers.common.types import RepOutcome, RepPhase
from app.analyzers.pull_up.config import PullUpAnalyzerConfig
from app.analyzers.pull_up.phases import PullUpPhaseTracker


def _start_rising_candidate(
    tracker: PullUpPhaseTracker,
    *,
    rising_angle_deg: float,
) -> None:
    tracker.update(
        timestamp_ms=0,
        angle_deg=160.0,
        body_relative_y=0.50,
    )

    tracker.update(
        timestamp_ms=100,
        angle_deg=rising_angle_deg,
        body_relative_y=0.47,
    )

    assert tracker.phase == RepPhase.RISING


def test_interrupt_discards_barely_started_candidate() -> None:
    tracker = PullUpPhaseTracker(PullUpAnalyzerConfig())

    _start_rising_candidate(
        tracker,
        rising_angle_deg=140.0,
    )

    interrupted = tracker.interrupt(
        timestamp_ms=250,
        reason_code="wrist_release_detected",
    )

    assert interrupted is None
    assert tracker.phase == RepPhase.UNKNOWN


def test_interrupt_keeps_meaningful_rising_attempt_uncertain() -> None:
    tracker = PullUpPhaseTracker(PullUpAnalyzerConfig())

    _start_rising_candidate(
        tracker,
        rising_angle_deg=85.0,
    )

    interrupted = tracker.interrupt(
        timestamp_ms=250,
        reason_code="tracking_lost",
    )

    assert interrupted is not None
    assert interrupted.outcome == RepOutcome.UNCERTAIN
    assert interrupted.reason_codes == ["tracking_lost"]
    assert tracker.phase == RepPhase.UNKNOWN


def test_interrupt_from_top_stays_uncertain() -> None:
    tracker = PullUpPhaseTracker(PullUpAnalyzerConfig())

    _start_rising_candidate(
        tracker,
        rising_angle_deg=85.0,
    )

    tracker.update(
        timestamp_ms=150,
        angle_deg=45.0,
        body_relative_y=0.30,
    )

    assert tracker.phase == RepPhase.TOP

    interrupted = tracker.interrupt(
        timestamp_ms=250,
        reason_code="wrist_release_detected",
    )

    assert interrupted is not None
    assert interrupted.outcome == RepOutcome.UNCERTAIN
    assert interrupted.reason_codes == ["wrist_release_detected"]
