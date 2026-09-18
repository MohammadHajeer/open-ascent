from __future__ import annotations

from dataclasses import dataclass

import pytest

import app.analyzers.pull_up.analyzer as analyzer_module
from app.analyzers.common.types import AnalysisOutcome
from app.analyzers.common.video import PoseVideoFrame, VideoMetadata
from app.analyzers.pull_up.config import PullUpAnalyzerConfig
from app.analyzers.pull_up.evidence import HangMetrics, WristHistorySample
from app.analyzers.pull_up.measurements import PullUpFrameMeasurement


@dataclass
class Landmark:
    x: float = 0.5
    y: float = 0.5
    visibility: float = 1.0


def make_landmarks() -> list[Landmark]:
    return [Landmark() for _ in range(33)]


def make_frames(count: int) -> list[PoseVideoFrame]:
    return [
        PoseVideoFrame(
            timestamp_ms=index * 100,
            frame_bgr=None,  # type: ignore[arg-type]
            landmarks=make_landmarks(),
        )
        for index in range(count)
    ]


@pytest.fixture
def fast_config() -> PullUpAnalyzerConfig:
    return PullUpAnalyzerConfig(
        target_pose_fps=10.0,
        hang_confirmation_seconds=0.2,
        angle_smoothing_seconds=0.1,
        invalid_position_tolerance_seconds=0.1,
        min_usable_evidence_seconds=0.2,
        min_usable_pose_ratio=0.4,
    )


def install_video_mocks(
    monkeypatch: pytest.MonkeyPatch,
    frames: list[PoseVideoFrame],
) -> None:
    monkeypatch.setattr(
        analyzer_module,
        "get_video_metadata",
        lambda _path: VideoMetadata(
            fps=10.0,
            frame_count=len(frames),
            duration_ms=len(frames) * 100,
        ),
    )

    monkeypatch.setattr(
        analyzer_module,
        "iter_pose_video_frames",
        lambda *_args, **_kwargs: iter(frames),
    )


def install_valid_hang_mocks(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        analyzer_module,
        "hands_are_above_shoulders",
        lambda _landmarks: True,
    )

    monkeypatch.setattr(
        analyzer_module,
        "body_is_under_hands",
        lambda _landmarks, **_kwargs: True,
    )

    monkeypatch.setattr(
        analyzer_module,
        "calculate_hang_metrics",
        lambda *_args, **_kwargs: HangMetrics(
            max_wrist_range=0.01,
            body_movement_range=0.02,
            wrists_stable=True,
        ),
    )


def install_body_motion(
    monkeypatch: pytest.MonkeyPatch,
    relative_y_values: list[float],
) -> None:
    values = iter(relative_y_values)

    monkeypatch.setattr(
        analyzer_module,
        "build_wrist_history_sample",
        lambda _landmarks: WristHistorySample(
            left_x=0.4,
            left_y=0.5,
            right_x=0.6,
            right_y=0.5,
            shoulder_relative_y=next(values),
        ),
    )


def install_angles(
    monkeypatch: pytest.MonkeyPatch,
    angles: list[float],
) -> None:
    values = iter(angles)

    monkeypatch.setattr(
        analyzer_module,
        "measure_pull_up_frame",
        lambda _landmarks, *, timestamp_ms, **_kwargs: (
            PullUpFrameMeasurement(
                timestamp_ms=timestamp_ms,
                left_elbow_angle_deg=150.0,
                right_elbow_angle_deg=150.0,
                average_elbow_angle_deg=next(values),
                minimum_required_visibility=1.0,
            )
        ),
    )


def test_good_evidence_with_no_rep_is_zero_valid_reps(
    monkeypatch: pytest.MonkeyPatch,
    fast_config: PullUpAnalyzerConfig,
) -> None:
    frames = make_frames(5)

    install_video_mocks(monkeypatch, frames)
    install_valid_hang_mocks(monkeypatch)
    install_body_motion(
        monkeypatch,
        [0.20, 0.20, 0.20, 0.20, 0.20],
    )
    install_angles(
        monkeypatch,
        [150.0, 150.0, 150.0, 150.0, 150.0],
    )

    result = analyzer_module.analyze_pull_up_video(
        analyzer_module.Path("fake.mp4"),
        config=fast_config,
    )

    assert result.outcome == AnalysisOutcome.ZERO_VALID_REPS
    assert result.valid_rep_count == 0
    assert result.evidence.hang_confirmed


def test_poor_pose_evidence_is_insufficient(
    monkeypatch: pytest.MonkeyPatch,
    fast_config: PullUpAnalyzerConfig,
) -> None:
    frames = make_frames(5)

    install_video_mocks(monkeypatch, frames)

    monkeypatch.setattr(
        analyzer_module,
        "measure_pull_up_frame",
        lambda *_args, **_kwargs: None,
    )

    result = analyzer_module.analyze_pull_up_video(
        analyzer_module.Path("fake.mp4"),
        config=fast_config,
    )

    assert (
        result.outcome
        == AnalysisOutcome.INSUFFICIENT_EVIDENCE
    )

    assert result.valid_rep_count == 0
    assert not result.evidence.hang_confirmed


def test_valid_rep_is_counted(
    monkeypatch: pytest.MonkeyPatch,
    fast_config: PullUpAnalyzerConfig,
) -> None:
    frames = make_frames(5)

    install_video_mocks(monkeypatch, frames)
    install_valid_hang_mocks(monkeypatch)

    install_body_motion(
        monkeypatch,
        [0.20, 0.17, 0.08, 0.12, 0.20],
    )

    install_angles(
        monkeypatch,
        [150.0, 120.0, 45.0, 90.0, 150.0],
    )

    result = analyzer_module.analyze_pull_up_video(
        analyzer_module.Path("fake.mp4"),
        config=fast_config,
    )

    assert result.outcome == AnalysisOutcome.COMPLETED
    assert result.valid_rep_count == 1
    assert result.partial_rep_count == 0


def test_confirmed_hang_allows_high_pull_geometry(
    monkeypatch: pytest.MonkeyPatch,
    fast_config: PullUpAnalyzerConfig,
) -> None:
    frames = make_frames(5)

    install_video_mocks(monkeypatch, frames)

    body_under_results = iter(
        [True, False, False, False, False]
    )
    hands_above_results = iter(
        [True, False, False, False, True]
    )

    monkeypatch.setattr(
        analyzer_module,
        "body_is_under_hands",
        lambda _landmarks, **_kwargs: next(
            body_under_results
        ),
    )

    monkeypatch.setattr(
        analyzer_module,
        "hands_are_above_shoulders",
        lambda _landmarks: next(
            hands_above_results
        ),
    )

    monkeypatch.setattr(
        analyzer_module,
        "calculate_hang_metrics",
        lambda *_args, **_kwargs: HangMetrics(
            max_wrist_range=0.01,
            body_movement_range=0.02,
            wrists_stable=True,
        ),
    )

    install_body_motion(
        monkeypatch,
        [0.20, 0.16, -0.02, 0.10, 0.20],
    )

    install_angles(
        monkeypatch,
        [150.0, 120.0, 40.0, 90.0, 150.0],
    )

    result = analyzer_module.analyze_pull_up_video(
        analyzer_module.Path("fake.mp4"),
        config=fast_config,
    )

    assert result.valid_rep_count == 1
    assert result.uncertain_rep_count == 0


def test_processing_exception_is_not_converted_to_zero_reps(
    monkeypatch: pytest.MonkeyPatch,
    fast_config: PullUpAnalyzerConfig,
) -> None:
    monkeypatch.setattr(
        analyzer_module,
        "get_video_metadata",
        lambda _path: (_ for _ in ()).throw(
            RuntimeError("decoder crashed")
        ),
    )

    with pytest.raises(
        RuntimeError,
        match="decoder crashed",
    ):
        analyzer_module.analyze_pull_up_video(
            analyzer_module.Path("fake.mp4"),
            config=fast_config,
        )
