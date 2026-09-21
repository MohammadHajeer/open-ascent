from dataclasses import dataclass, replace

import pytest

from app.analyzers.common.types import RepAnalysis, RepOutcome
from app.analyzers.pull_up.classification import (
    add_pose_variations,
    build_variation_diagnostic,
    observe_variation,
)
from app.analyzers.pull_up.config import PullUpAnalyzerConfig
from app.analyzers.pull_up.measurements import PullUpFrameMeasurement
from app.analyzers.pull_up.targets import compare_rep


@dataclass
class Landmark:
    x: float = 0.5
    y: float = 0.5
    visibility: float = 0.99


def observation(
    width_ratio: float,
    chest_bar_ratio: float,
    timestamp: int,
    *,
    face: float | None = -0.02,
    y_scale: float = 1.0,
):
    landmarks = [Landmark() for _ in range(33)]
    shoulder_y = 0.3 + (chest_bar_ratio - 0.25) * 0.2
    landmarks[11] = Landmark(0.4, shoulder_y)
    landmarks[12] = Landmark(0.6, shoulder_y)
    landmarks[23] = Landmark(0.4, shoulder_y + 0.2)
    landmarks[24] = Landmark(0.6, shoulder_y + 0.2)
    landmarks[15] = Landmark(0.5 - width_ratio * 0.1, 0.3)
    landmarks[16] = Landmark(0.5 + width_ratio * 0.1, 0.3)
    for index in (11, 12, 15, 16, 23, 24):
        landmarks[index].y *= y_scale
    measurement = PullUpFrameMeasurement(timestamp, 40, 40, 40, 0.99, face)
    return observe_variation(landmarks, measurement, config=PullUpAnalyzerConfig())


def rep(movement: str, index: int = 1) -> RepAnalysis:
    return RepAnalysis(
        index,
        RepOutcome.VALID,
        index * 100,
        index * 100 + 80,
        top_ms=index * 100 + 50,
        variations={"movement": movement, "base_movement": movement},
    )


@pytest.mark.parametrize(
    "width_ratio,chest_ratio,width,height",
    [
        (1.2, 0.45, "standard", "standard"),
        (0.7, 0.45, "close", "standard"),
        (1.8, 0.45, "wide", "standard"),
        (1.2, 0.08, "standard", "high"),
        (0.7, 0.08, "close", "high"),
        (1.8, 0.08, "wide", "high"),
    ],
)
def test_per_rep_dimensions(width_ratio, chest_ratio, width, height):
    samples = [observation(width_ratio, chest_ratio, time) for time in (110, 120, 130)]
    result = add_pose_variations(rep("pull_up"), samples, config=PullUpAnalyzerConfig())
    assert result.variations["grip_width"] == width
    assert result.variations["pull_height"] == height


def test_chin_up_and_pull_up_can_change_within_one_set():
    samples = [observation(0.7, 0.45, time) for time in (110, 120, 130)]
    samples += [observation(1.8, 0.0, time) for time in (210, 220, 230)]
    first = add_pose_variations(rep("pull_up"), samples, config=PullUpAnalyzerConfig())
    second = add_pose_variations(
        rep("chin_up", 2), samples, config=PullUpAnalyzerConfig()
    )
    assert (first.variations["base_movement"], first.variations["grip_width"]) == (
        "pull_up",
        "close",
    )
    assert (second.variations["base_movement"], second.variations["pull_height"]) == (
        "chin_up",
        "high",
    )


def test_insufficient_or_ambiguous_evidence_stays_uncertain():
    samples = [observation(0.92, 0.15, time, face=None) for time in (110, 120)]
    result = add_pose_variations(rep("pull_up"), samples, config=PullUpAnalyzerConfig())
    assert result.variations["grip_width"] == "uncertain"
    assert result.variations["pull_height"] == "uncertain"
    ambiguous = [observation(1.2, 0.15, time) for time in (110, 120, 130)]
    result = add_pose_variations(
        rep("pull_up"), ambiguous, config=PullUpAnalyzerConfig()
    )
    assert result.variations["pull_height"] == "uncertain"


@pytest.mark.parametrize(
    "chest_ratio,expected",
    [
        (0.08, "high"),
        (0.15, "uncertain"),
        (0.26, "standard"),
    ],
)
def test_height_calibration_preserves_conservative_uncertainty_band(
    chest_ratio, expected
):
    samples = [observation(1.2, chest_ratio, time) for time in (110, 120, 130)]
    classified = add_pose_variations(
        rep("pull_up"), samples, config=PullUpAnalyzerConfig()
    )
    assert classified.variations["pull_height"] == expected


def test_chin_above_bar_is_not_itself_high_evidence():
    samples = [observation(1.2, 0.42, time, face=-0.08) for time in (110, 120, 130)]
    classified = add_pose_variations(
        rep("pull_up"), samples, config=PullUpAnalyzerConfig()
    )
    assert classified.variations["pull_height"] == "standard"


def test_height_score_is_invariant_to_vertical_image_scaling():
    portrait = observation(1.2, 0.4, 110)
    landscape = observation(1.2, 0.4, 110, y_scale=0.6)
    assert portrait.chest_to_wrist_ratio == pytest.approx(
        landscape.chest_to_wrist_ratio
    )


def test_height_is_independent_of_width_uncertainty_and_face_visibility():
    samples = [observation(0.05, 0.4, time, face=None) for time in (110, 120, 130)]
    classified = add_pose_variations(
        rep("pull_up"), samples, config=PullUpAnalyzerConfig()
    )
    assert classified.variations["grip_width"] == "uncertain"
    assert classified.variations["pull_height"] == "standard"


def test_peak_after_first_top_is_used_without_changing_top_timestamp():
    samples = [observation(1.2, 0.45, time) for time in (110, 120, 130)]
    samples += [observation(1.2, 0.0, time) for time in (160, 170, 180, 190, 200)]
    candidate = replace(rep("pull_up"), end_ms=250)
    classified = add_pose_variations(candidate, samples, config=PullUpAnalyzerConfig())
    assert classified.top_ms == 150
    assert classified.outcome == RepOutcome.VALID
    assert classified.variations["pull_height"] == "high"


def test_one_extreme_height_frame_cannot_turn_normal_rep_high():
    samples = [observation(1.2, 0.45, time) for time in (160, 170, 190, 200, 210, 220)]
    samples.append(observation(1.2, -0.2, 180))
    candidate = replace(rep("pull_up"), end_ms=250)
    classified = add_pose_variations(candidate, samples, config=PullUpAnalyzerConfig())
    assert classified.variations["pull_height"] == "standard"


def test_global_camera_translation_does_not_reject_stable_height_score():
    offsets = (0.0, 0.05, -0.04, 0.03, -0.02)
    samples = []
    for time, offset in zip((160, 170, 180, 190, 200), offsets, strict=True):
        sample = observation(1.2, 0.08, time)
        samples.append(
            replace(
                sample,
                wrist_mid_y=sample.wrist_mid_y + offset,
                shoulder_mid_y=sample.shoulder_mid_y + offset,
                torso_mid_y=sample.torso_mid_y + offset,
            )
        )
    candidate = replace(rep("pull_up"), end_ms=250)
    classified = add_pose_variations(candidate, samples, config=PullUpAnalyzerConfig())
    assert classified.variations["pull_height"] == "high"


def test_unstable_inferred_bar_line_remains_uncertain():
    scores = (-0.4, -0.2, 0.0, 0.2, 0.4)
    samples = []
    for time, score in zip((160, 170, 180, 190, 200), scores, strict=True):
        sample = observation(1.2, 0.0, time)
        samples.append(
            replace(
                sample,
                chest_to_wrist_ratio=score,
                wrist_mid_y=sample.wrist_mid_y - score * sample.torso_span_y,
            )
        )
    candidate = replace(rep("pull_up"), end_ms=250)
    classified = add_pose_variations(candidate, samples, config=PullUpAnalyzerConfig())
    assert classified.variations["pull_height"] == "uncertain"


def test_one_noisy_width_frame_does_not_overturn_consistent_rep():
    samples = [observation(0.7, 0.4, time) for time in (110, 120, 130)]
    samples.append(observation(1.8, 0.4, 140))
    classified = add_pose_variations(
        rep("pull_up"), samples, config=PullUpAnalyzerConfig()
    )
    assert classified.variations["grip_width"] == "close"


def test_private_diagnostic_explains_decision_without_entering_result():
    samples = [observation(1.2, 0.4, time) for time in (110, 120, 130)]
    classified = add_pose_variations(
        rep("pull_up"), samples, config=PullUpAnalyzerConfig()
    )
    diagnostic = build_variation_diagnostic(
        classified, samples, config=PullUpAnalyzerConfig()
    )
    assert diagnostic["height"]["reason"] == "upper_chest_below_bar"
    assert diagnostic["height"]["selected_window"]["samples"] == 3
    assert diagnostic["width"]["frame_reasons"] == {"classified": 3}
    assert "top_phase_samples" in diagnostic
    assert "top_phase_samples" not in classified.variations


def test_height_changes_per_rep_even_when_base_movement_is_same():
    samples = [observation(1.2, 0.4, time) for time in (110, 120, 130)]
    samples += [observation(1.2, 0.0, time) for time in (210, 220, 230)]
    first = add_pose_variations(rep("pull_up"), samples, config=PullUpAnalyzerConfig())
    second = add_pose_variations(
        rep("pull_up", 2), samples, config=PullUpAnalyzerConfig()
    )
    assert first.variations["pull_height"] == "standard"
    assert second.variations["pull_height"] == "high"


@pytest.mark.parametrize(
    "slug,attributes",
    [
        (
            "pull-up",
            {
                "base_movement": "pull_up",
                "grip_width": "standard",
                "pull_height": "standard",
            },
        ),
        (
            "chin-up",
            {
                "base_movement": "chin_up",
                "grip_width": "close",
                "pull_height": "standard",
            },
        ),
        (
            "close-grip-pull-up",
            {"base_movement": "pull_up", "grip_width": "close", "pull_height": "high"},
        ),
        (
            "wide-grip-pull-up",
            {"base_movement": "pull_up", "grip_width": "wide", "pull_height": "high"},
        ),
        (
            "high-pull-up",
            {"base_movement": "pull_up", "grip_width": "wide", "pull_height": "high"},
        ),
    ],
)
def test_target_signatures_accept_additional_attributes(slug, attributes):
    candidate = rep(attributes["base_movement"])
    candidate = replace(candidate, variations=attributes)
    assert compare_rep(candidate, slug).target_match is True


def test_valid_target_deviation_is_not_invalid_rep():
    candidate = replace(
        rep("pull_up"),
        variations={
            "base_movement": "pull_up",
            "grip_width": "wide",
            "pull_height": "standard",
        },
    )
    compared = compare_rep(candidate, "close-grip-pull-up")
    assert compared.outcome == RepOutcome.VALID
    assert compared.target_match is False
    assert compared.target_deviations == [
        {"dimension": "grip_width", "expected": "close", "detected": "wide"}
    ]
    assert compare_rep(candidate, None).target_match is None
    assert compare_rep(candidate, None).target_deviations == []


def test_high_target_uses_height_but_does_not_change_validity():
    standard = replace(
        rep("pull_up"),
        variations={
            "base_movement": "pull_up",
            "grip_width": "standard",
            "pull_height": "standard",
        },
    )
    high = replace(standard, variations={**standard.variations, "pull_height": "high"})
    comparison = compare_rep(standard, "high-pull-up")
    assert comparison.outcome == RepOutcome.VALID
    assert comparison.target_match is False
    assert comparison.target_deviations == [
        {"dimension": "pull_height", "expected": "high", "detected": "standard"}
    ]
    assert compare_rep(high, "high-pull-up").target_match is True


def test_unknown_required_dimension_does_not_claim_a_match():
    assert compare_rep(rep("uncertain"), "pull-up").target_match is None
