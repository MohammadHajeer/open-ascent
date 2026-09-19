from __future__ import annotations

from app.analyzers.pull_up.evidence import (
    WristHistorySample,
    calculate_hang_metrics,
)


def test_global_camera_translation_does_not_break_wrist_stability() -> None:
    shifts = [
        (0.00, 0.00),
        (0.03, 0.02),
        (-0.02, 0.04),
        (0.04, -0.01),
        (0.01, 0.03),
    ]

    samples = [
        WristHistorySample(
            left_x=0.40 + shift_x,
            left_y=0.20 + shift_y,
            right_x=0.60 + shift_x,
            right_y=0.20 + shift_y,
            shoulder_relative_y=0.10 + index * 0.004,
        )
        for index, (shift_x, shift_y) in enumerate(shifts)
    ]

    metrics = calculate_hang_metrics(
        samples,
        required_samples=5,
        wrist_stability_threshold=0.025,
    )

    assert metrics is not None

    # The old raw-coordinate rule would reject this window.
    assert metrics.max_wrist_range > 0.025

    # Global camera translation keeps the wrist-to-wrist span stable.
    assert metrics.wrists_stable
    assert metrics.wrist_span_range < 1e-6


def test_independent_wrist_drift_is_still_rejected() -> None:
    samples = [
        WristHistorySample(
            left_x=0.40,
            left_y=0.20,
            right_x=0.60 + index * 0.02,
            right_y=0.20,
            shoulder_relative_y=0.10 + index * 0.004,
        )
        for index in range(5)
    ]

    metrics = calculate_hang_metrics(
        samples,
        required_samples=5,
        wrist_stability_threshold=0.025,
    )

    assert metrics is not None
    assert not metrics.wrists_stable
    assert metrics.wrist_span_range > 0.025
