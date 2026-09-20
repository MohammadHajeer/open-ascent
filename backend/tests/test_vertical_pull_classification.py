from dataclasses import dataclass, replace

import pytest

from app.analyzers.common.types import RepAnalysis, RepOutcome
from app.analyzers.pull_up.classification import (
    add_pose_variations,
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
    shoulder_bar_ratio: float,
    timestamp: int,
    *,
    face: float | None = -0.02,
):
    landmarks = [Landmark() for _ in range(33)]
    landmarks[11] = Landmark(0.4, 0.3 + shoulder_bar_ratio * 0.2)
    landmarks[12] = Landmark(0.6, 0.3 + shoulder_bar_ratio * 0.2)
    landmarks[15] = Landmark(0.5 - width_ratio * 0.1, 0.3)
    landmarks[16] = Landmark(0.5 + width_ratio * 0.1, 0.3)
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
    "width_ratio,height_ratio,width,height",
    [
        (1.2, 1.0, "standard", "standard"),
        (0.7, 1.0, "close", "standard"),
        (1.8, 1.0, "wide", "standard"),
        (1.2, 0.2, "standard", "high"),
        (0.7, 0.2, "close", "high"),
        (1.8, 0.2, "wide", "high"),
    ],
)
def test_per_rep_dimensions(width_ratio, height_ratio, width, height):
    samples = [observation(width_ratio, height_ratio, time) for time in (110, 120, 130)]
    result = add_pose_variations(rep("pull_up"), samples, config=PullUpAnalyzerConfig())
    assert result.variations["grip_width"] == width
    assert result.variations["pull_height"] == height


def test_chin_up_and_pull_up_can_change_within_one_set():
    samples = [observation(0.7, 1.0, time) for time in (110, 120, 130)]
    samples += [observation(1.8, 0.2, time) for time in (210, 220, 230)]
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
    samples = [observation(0.92, 0.5, time, face=None) for time in (110, 120)]
    result = add_pose_variations(rep("pull_up"), samples, config=PullUpAnalyzerConfig())
    assert result.variations["grip_width"] == "uncertain"
    assert result.variations["pull_height"] == "uncertain"
    ambiguous = [observation(1.2, 0.5, time) for time in (110, 120, 130)]
    result = add_pose_variations(rep("pull_up"), ambiguous, config=PullUpAnalyzerConfig())
    assert result.variations["pull_height"] == "uncertain"


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


def test_unknown_required_dimension_does_not_claim_a_match():
    assert compare_rep(rep("uncertain"), "pull-up").target_match is None
