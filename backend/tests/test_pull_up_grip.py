from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from app.analyzers.common.types import RepAnalysis, RepOutcome
from app.analyzers.pull_up.config import PullUpAnalyzerConfig
from app.analyzers.pull_up.grip import (
    GripObservation,
    HandCrop,
    HandGripDetector,
    add_grip_variations,
    calculate_palm_facing_score,
    classify_single_hand_grip,
    combine_hand_grips,
    expected_hand_label,
    select_hand_index,
    summarize_rep_grip,
)


def observation(
    timestamp_ms: int,
    grip: str,
) -> GripObservation:
    return GripObservation(
        timestamp_ms=timestamp_ms,
        grip=grip,
        left_grip=grip,
        right_grip=grip,
        left_score=None,
        right_score=None,
    )


def test_matching_pronated_hands_form_pronated_grip() -> None:
    assert combine_hand_grips(
        "pronated",
        "pronated",
    ) == "pronated"


def test_matching_supinated_hands_form_supinated_grip() -> None:
    assert combine_hand_grips(
        "supinated",
        "supinated",
    ) == "supinated"


def test_mixed_confident_hands_are_asymmetric() -> None:
    assert combine_hand_grips(
        "pronated",
        "supinated",
    ) == "asymmetric"


def test_single_confident_hand_can_classify_frame() -> None:
    assert combine_hand_grips(
        "pronated",
        "uncertain",
    ) == "pronated"

    assert combine_hand_grips(
        "not_detected",
        "supinated",
    ) == "supinated"


def test_no_confident_hands_stay_uncertain() -> None:
    assert combine_hand_grips(
        "uncertain",
        "not_detected",
    ) == "uncertain"


def test_pronated_rep_is_classified_as_pull_up() -> None:
    config = PullUpAnalyzerConfig(
        min_rep_grip_samples=3,
        rep_grip_majority_ratio=0.70,
    )

    observations = [
        observation(100, "pronated"),
        observation(200, "pronated"),
        observation(300, "pronated"),
        observation(400, "supinated"),
    ]

    summary = summarize_rep_grip(
        observations,
        start_ms=50,
        end_ms=450,
        config=config,
    )

    assert summary.grip == "pronated"
    assert summary.movement == "pull_up"
    assert summary.agreement == 0.75


def test_supinated_rep_is_classified_as_chin_up() -> None:
    config = PullUpAnalyzerConfig()

    observations = [
        observation(100, "supinated"),
        observation(200, "supinated"),
        observation(300, "supinated"),
    ]

    summary = summarize_rep_grip(
        observations,
        start_ms=50,
        end_ms=350,
        config=config,
    )

    assert summary.grip == "supinated"
    assert summary.movement == "chin_up"


def test_not_enough_grip_evidence_stays_uncertain() -> None:
    config = PullUpAnalyzerConfig(
        min_rep_grip_samples=3,
    )

    observations = [
        observation(100, "pronated"),
        observation(200, "pronated"),
    ]

    summary = summarize_rep_grip(
        observations,
        start_ms=50,
        end_ms=250,
        config=config,
    )

    assert summary.grip == "uncertain"
    assert summary.movement == "uncertain"


def test_two_unanimous_high_margin_hand_frames_resolve_pull_up() -> None:
    config = PullUpAnalyzerConfig()
    observations = [
        GripObservation(
            timestamp_ms=100,
            grip="pronated",
            left_grip="not_detected",
            right_grip="pronated",
            left_score=None,
            right_score=0.52,
        ),
        GripObservation(
            timestamp_ms=200,
            grip="asymmetric",
            left_grip="supinated",
            right_grip="pronated",
            left_score=-0.21,
            right_score=0.49,
        ),
    ]

    summary = summarize_rep_grip(
        observations,
        start_ms=50,
        end_ms=250,
        config=config,
    )

    assert summary.grip == "pronated"
    assert summary.movement == "pull_up"
    assert summary.usable_samples == 2
    assert summary.agreement == 1.0


def test_two_unanimous_high_margin_hand_frames_resolve_chin_up() -> None:
    config = PullUpAnalyzerConfig()
    observations = [
        GripObservation(
            timestamp_ms=100,
            grip="supinated",
            left_grip="supinated",
            right_grip="not_detected",
            left_score=-0.58,
            right_score=None,
        ),
        GripObservation(
            timestamp_ms=200,
            grip="supinated",
            left_grip="not_detected",
            right_grip="supinated",
            left_score=None,
            right_score=-0.47,
        ),
    ]

    summary = summarize_rep_grip(
        observations,
        start_ms=50,
        end_ms=250,
        config=config,
    )

    assert summary.grip == "supinated"
    assert summary.movement == "chin_up"


def test_sparse_near_threshold_hand_evidence_stays_uncertain() -> None:
    config = PullUpAnalyzerConfig()
    observations = [
        GripObservation(
            timestamp_ms=100,
            grip="pronated",
            left_grip="pronated",
            right_grip="not_detected",
            left_score=0.25,
            right_score=None,
        ),
        GripObservation(
            timestamp_ms=200,
            grip="pronated",
            left_grip="not_detected",
            right_grip="pronated",
            left_score=None,
            right_score=0.30,
        ),
    ]

    summary = summarize_rep_grip(
        observations,
        start_ms=50,
        end_ms=250,
        config=config,
    )

    assert summary.grip == "uncertain"
    assert summary.movement == "uncertain"


def test_rep_receives_grip_variations() -> None:
    config = PullUpAnalyzerConfig()

    rep = RepAnalysis(
        rep_index=1,
        outcome=RepOutcome.VALID,
        start_ms=100,
        end_ms=500,
    )

    observations = [
        observation(150, "supinated"),
        observation(250, "supinated"),
        observation(350, "supinated"),
    ]

    classified = add_grip_variations(
        rep,
        observations,
        config=config,
    )

    assert classified.variations == {
        "movement": "chin_up",
        "grip_orientation": "supinated",
    }


@dataclass(frozen=True, slots=True)
class FakeHandLandmark:
    x: float
    y: float
    z: float = 0.0


@dataclass(frozen=True, slots=True)
class FakeCategory:
    category_name: str
    score: float


@dataclass(frozen=True, slots=True)
class FakeDetectionResult:
    hand_landmarks: list[list[FakeHandLandmark]]
    handedness: list[list[FakeCategory]]


class FakeLandmarker:
    def __init__(self, result: FakeDetectionResult) -> None:
        self.result = result

    def detect(self, _image: object) -> FakeDetectionResult:
        return self.result


def fake_hand(
    wrist_x: float,
    wrist_y: float,
) -> list[FakeHandLandmark]:
    landmarks = [
        FakeHandLandmark(0.0, 0.0)
        for _ in range(21)
    ]
    landmarks[0] = FakeHandLandmark(
        wrist_x,
        wrist_y,
    )
    return landmarks


def palm_hand(
    *,
    wrist: tuple[float, float],
    index_mcp: tuple[float, float],
    pinky_mcp: tuple[float, float],
) -> list[FakeHandLandmark]:
    landmarks = [
        FakeHandLandmark(0.0, 0.0)
        for _ in range(21)
    ]
    landmarks[0] = FakeHandLandmark(*wrist)
    landmarks[5] = FakeHandLandmark(*index_mcp)
    landmarks[17] = FakeHandLandmark(*pinky_mcp)
    return landmarks


def test_expected_hand_label_accounts_for_mediapipe_mirroring() -> None:
    assert expected_hand_label(
        "left",
        hand_labels_are_mirrored=True,
    ) == "right"

    assert expected_hand_label(
        "right",
        hand_labels_are_mirrored=True,
    ) == "left"


def test_expected_hand_label_can_use_non_mirrored_convention() -> None:
    assert expected_hand_label(
        "left",
        hand_labels_are_mirrored=False,
    ) == "left"

    assert expected_hand_label(
        "right",
        hand_labels_are_mirrored=False,
    ) == "right"


def test_selects_matching_handedness_near_target_wrist() -> None:
    wrong_hand = fake_hand(0.20, 0.50)
    target_hand = fake_hand(0.52, 0.48)

    selected_index = select_hand_index(
        [wrong_hand, target_hand],
        [
            ("right", 0.99),
            ("left", 0.98),
        ],
        target_wrist_x=0.50,
        target_wrist_y=0.50,
        expected_label="left",
        max_distance=0.35,
    )

    assert selected_index == 1


def test_hand_selection_returns_none_without_detections() -> None:
    selected_index = select_hand_index(
        [],
        [],
        target_wrist_x=0.50,
        target_wrist_y=0.50,
        expected_label="left",
        max_distance=0.35,
    )

    assert selected_index is None


def test_hand_selection_rejects_detection_far_from_target_wrist() -> None:
    far_hand = fake_hand(0.95, 0.95)

    selected_index = select_hand_index(
        [far_hand],
        [("left", 0.99)],
        target_wrist_x=0.10,
        target_wrist_y=0.10,
        expected_label="left",
        max_distance=0.35,
    )

    assert selected_index is None


def test_mirrored_hand_winding_is_corrected_by_detected_handedness() -> None:
    right_hand = palm_hand(
        wrist=(0.50, 0.80),
        index_mcp=(0.80, 0.40),
        pinky_mcp=(0.20, 0.40),
    )

    mirrored_left_hand = palm_hand(
        wrist=(0.50, 0.80),
        index_mcp=(0.20, 0.40),
        pinky_mcp=(0.80, 0.40),
    )

    right_score = calculate_palm_facing_score(
        right_hand,
        hand_label="right",
        palm_score_direction=-1.0,
    )

    left_score = calculate_palm_facing_score(
        mirrored_left_hand,
        hand_label="left",
        palm_score_direction=-1.0,
    )

    assert right_score is not None
    assert left_score is not None
    assert abs(right_score - left_score) < 1e-9


def test_nearly_collinear_palm_geometry_has_weak_orientation_score() -> None:
    hand = palm_hand(
        wrist=(0.50, 0.80),
        index_mcp=(0.49, 0.40),
        pinky_mcp=(0.51, 0.00),
    )

    score = calculate_palm_facing_score(
        hand,
        hand_label="right",
        palm_score_direction=-1.0,
    )

    assert score is not None
    assert abs(score) < 0.20


def test_nearly_collinear_palm_geometry_is_uncertain() -> None:
    config = PullUpAnalyzerConfig(
        palm_facing_threshold=0.20,
        palm_score_direction=-1.0,
        athlete_faces_camera=True,
    )

    hand = palm_hand(
        wrist=(0.50, 0.80),
        index_mcp=(0.49, 0.40),
        pinky_mcp=(0.51, 0.00),
    )

    label, score = classify_single_hand_grip(
        hand,
        hand_label="right",
        config=config,
    )

    assert label == "uncertain"
    assert score is not None
    assert abs(score) < config.palm_facing_threshold


def test_clear_pronated_geometry_is_classified_as_pronated() -> None:
    config = PullUpAnalyzerConfig(
        palm_facing_threshold=0.20,
        palm_score_direction=-1.0,
        athlete_faces_camera=True,
    )

    hand = palm_hand(
        wrist=(0.50, 0.80),
        index_mcp=(0.80, 0.40),
        pinky_mcp=(0.20, 0.40),
    )

    label, score = classify_single_hand_grip(
        hand,
        hand_label="right",
        config=config,
    )

    assert score is not None
    assert score > config.palm_facing_threshold
    assert label == "pronated"


def test_clear_supinated_geometry_is_classified_as_supinated() -> None:
    config = PullUpAnalyzerConfig(
        palm_facing_threshold=0.20,
        palm_score_direction=-1.0,
        athlete_faces_camera=True,
    )

    hand = palm_hand(
        wrist=(0.50, 0.80),
        index_mcp=(0.20, 0.40),
        pinky_mcp=(0.80, 0.40),
    )

    label, score = classify_single_hand_grip(
        hand,
        hand_label="right",
        config=config,
    )

    assert score is not None
    assert score < -config.palm_facing_threshold
    assert label == "supinated"


def test_low_handedness_confidence_is_rejected_as_uncertain() -> None:
    config = PullUpAnalyzerConfig(
        min_handedness_confidence=0.60,
    )

    hand = palm_hand(
        wrist=(0.50, 0.80),
        index_mcp=(0.80, 0.40),
        pinky_mcp=(0.20, 0.40),
    )

    result = FakeDetectionResult(
        hand_landmarks=[hand],
        handedness=[
            [
                FakeCategory(
                    category_name="Right",
                    score=0.40,
                )
            ]
        ],
    )

    detector = HandGripDetector(
        model_path=None,  # type: ignore[arg-type]
        config=config,
    )

    crop = HandCrop(
        image_bgr=np.zeros((64, 64, 3), dtype=np.uint8),
        target_wrist_x=0.50,
        target_wrist_y=0.80,
        width_px=64,
        height_px=64,
    )

    classified = detector._detect_single_hand(
        FakeLandmarker(result),  # type: ignore[arg-type]
        crop,
        body_side="left",
    )

    assert classified.label == "uncertain"
    assert classified.score is None
    assert classified.hand_label == "right"
    assert classified.hand_label_score == 0.40
