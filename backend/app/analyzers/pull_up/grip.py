from __future__ import annotations

from collections import Counter
from collections.abc import Iterable, Sequence
from dataclasses import dataclass, replace
from pathlib import Path
from typing import Protocol, Self

import cv2
import mediapipe as mp
import numpy as np
from mediapipe.tasks.python import vision

from app.analyzers.common.types import RepAnalysis
from app.analyzers.pull_up.config import PullUpAnalyzerConfig
from app.analyzers.pull_up.measurements import (
    LEFT_SHOULDER,
    LEFT_WRIST,
    RIGHT_SHOULDER,
    RIGHT_WRIST,
)

HAND_WRIST = 0
HAND_INDEX_MCP = 5
HAND_PINKY_MCP = 17

CONFIDENT_GRIPS = frozenset({"pronated", "supinated"})


class PoseLandmark2D(Protocol):
    x: float
    y: float


class HandLandmark3D(Protocol):
    x: float
    y: float
    z: float


class HandednessCategory(Protocol):
    category_name: str
    score: float


@dataclass(frozen=True, slots=True)
class GripObservation:
    timestamp_ms: int
    grip: str
    left_grip: str
    right_grip: str
    left_score: float | None
    right_score: float | None
    # Diagnostics: what MediaPipe thought each detection was. When these
    # disagree with the crop they came from, the detector mirrored the
    # skeleton -- which is exactly the case the sign logic now absorbs.
    left_hand_label: str | None = None
    right_hand_label: str | None = None


@dataclass(frozen=True, slots=True)
class GripSummary:
    grip: str
    movement: str
    usable_samples: int
    total_samples: int
    agreement: float


@dataclass(frozen=True, slots=True)
class HandCrop:
    image_bgr: np.ndarray
    target_wrist_x: float
    target_wrist_y: float
    width_px: int
    height_px: int


@dataclass(frozen=True, slots=True)
class SingleHandGrip:
    label: str
    score: float | None
    hand_label: str | None
    hand_label_score: float | None


def calculate_palm_facing_score(
    hand_landmarks: Sequence[HandLandmark3D],
    *,
    hand_label: str,
    palm_score_direction: float,
    crop_width_px: float = 1.0,
    crop_height_px: float = 1.0,
) -> float | None:
    """Signed, image-plane measure of which way the palm faces.

    ``hand_label`` is the *detected* handedness ("left" / "right"), not the
    body side of the crop. Those two disagree whenever MediaPipe mirrors the
    skeleton, and when it mirrors the skeleton it also swaps the index and
    pinky landmark identities -- which inverts the winding this function
    reads. Keying the flip off the detected label cancels both at once.

    Landmark x is normalized by crop width and y by crop height, so the raw
    normalized coordinates are anisotropic on a non-square crop. Passing the
    crop dimensions restores true pixel geometry.
    """

    wrist = hand_landmarks[HAND_WRIST]
    index_mcp = hand_landmarks[HAND_INDEX_MCP]
    pinky_mcp = hand_landmarks[HAND_PINKY_MCP]

    index_vector = np.array(
        [
            (index_mcp.x - wrist.x) * crop_width_px,
            (index_mcp.y - wrist.y) * crop_height_px,
        ],
        dtype=np.float64,
    )
    pinky_vector = np.array(
        [
            (pinky_mcp.x - wrist.x) * crop_width_px,
            (pinky_mcp.y - wrist.y) * crop_height_px,
        ],
        dtype=np.float64,
    )

    index_length = float(np.linalg.norm(index_vector))
    pinky_length = float(np.linalg.norm(pinky_vector))

    if index_length < 1e-6 or pinky_length < 1e-6:
        return None

    cross_z = float(
        index_vector[0] * pinky_vector[1]
        - index_vector[1] * pinky_vector[0]
    )

    # sin() of the angle the palm triangle subtends in the image. The old
    # version divided a purely 2D numerator by 3D vector lengths, so an
    # edge-on palm did NOT drive the score toward zero the way the comment
    # claimed -- MediaPipe regularizes toward a canonical hand shape, so the
    # projected triangle stays wide open and only its sign is unstable. This
    # form really does collapse to 0 at the degeneracy, so the threshold can
    # reject it instead of letting a confidently wrong sign through.
    raw_score = cross_z / (index_length * pinky_length)

    if hand_label == "left":
        raw_score *= -1.0

    return raw_score * palm_score_direction


def classify_single_hand_grip(
    hand_landmarks: Sequence[HandLandmark3D],
    *,
    hand_label: str,
    config: PullUpAnalyzerConfig,
    crop_width_px: float = 1.0,
    crop_height_px: float = 1.0,
) -> tuple[str, float | None]:
    score = calculate_palm_facing_score(
        hand_landmarks,
        hand_label=hand_label,
        palm_score_direction=config.palm_score_direction,
        crop_width_px=crop_width_px,
        crop_height_px=crop_height_px,
    )

    if score is None:
        return "uncertain", None

    if abs(score) < config.palm_facing_threshold:
        return "uncertain", score

    palm_toward_camera = score > 0

    if not config.athlete_faces_camera:
        palm_toward_camera = not palm_toward_camera

    if palm_toward_camera:
        return "pronated", score

    return "supinated", score


def combine_hand_grips(
    left_label: str,
    right_label: str,
) -> str:
    left_ok = left_label in CONFIDENT_GRIPS
    right_ok = right_label in CONFIDENT_GRIPS

    if left_ok and right_ok:
        if left_label == right_label:
            return left_label

        return "asymmetric"

    # Wide grips push one hand toward (or past) the frame edge far more
    # often than narrow ones. Falling back to the single confident hand
    # keeps those frames usable instead of starving the rep-level vote.
    if left_ok:
        return left_label

    if right_ok:
        return right_label

    return "uncertain"


def movement_from_grip(grip: str) -> str:
    if grip == "pronated":
        return "pull_up"

    if grip == "supinated":
        return "chin_up"

    return "uncertain"


def summarize_rep_grip(
    observations: Sequence[GripObservation],
    *,
    start_ms: int,
    end_ms: int,
    config: PullUpAnalyzerConfig,
) -> GripSummary:
    rep_observations = [
        observation
        for observation in observations
        if start_ms <= observation.timestamp_ms <= end_ms
    ]

    usable = [
        observation.grip
        for observation in rep_observations
        if observation.grip in CONFIDENT_GRIPS
    ]

    if len(usable) < config.min_rep_grip_samples:
        return GripSummary(
            grip="uncertain",
            movement="uncertain",
            usable_samples=len(usable),
            total_samples=len(rep_observations),
            agreement=0.0,
        )

    counts = Counter(usable)
    winner, winner_count = counts.most_common(1)[0]

    agreement = winner_count / len(usable)

    if agreement < config.rep_grip_majority_ratio:
        winner = "uncertain"

    return GripSummary(
        grip=winner,
        movement=movement_from_grip(winner),
        usable_samples=len(usable),
        total_samples=len(rep_observations),
        agreement=agreement,
    )


def add_grip_variations(
    rep: RepAnalysis,
    observations: Sequence[GripObservation],
    *,
    config: PullUpAnalyzerConfig,
) -> RepAnalysis:
    summary = summarize_rep_grip(
        observations,
        start_ms=rep.start_ms,
        end_ms=rep.end_ms,
        config=config,
    )

    variations = {
        **rep.variations,
        "movement": summary.movement,
        "grip_orientation": summary.grip,
    }

    return replace(
        rep,
        variations=variations,
    )


def expected_hand_label(
    body_side: str,
    *,
    hand_labels_are_mirrored: bool,
) -> str:
    """Which handedness label MediaPipe should report for a body side.

    MediaPipe assigns handedness assuming a mirrored (selfie-view) input, so
    on ordinary non-mirrored footage the athlete's left hand is reported as
    "Right". ``hand_labels_are_mirrored`` lets that convention be flipped for
    front-camera clips without touching the winding logic.
    """

    if hand_labels_are_mirrored:
        return "right" if body_side == "left" else "left"

    return body_side


def read_hand_labels(
    handedness: Iterable[Sequence[HandednessCategory]],
) -> list[tuple[str | None, float]]:
    labels: list[tuple[str | None, float]] = []

    for categories in handedness:
        if not categories:
            labels.append((None, 0.0))
            continue

        top = max(categories, key=lambda category: category.score)
        labels.append(
            (top.category_name.lower(), float(top.score))
        )

    return labels


def select_hand_index(
    hands: Sequence[Sequence[HandLandmark3D]],
    hand_labels: Sequence[tuple[str | None, float]],
    *,
    target_wrist_x: float,
    target_wrist_y: float,
    expected_label: str,
    max_distance: float,
) -> int | None:
    """Pick the detection that belongs to the pose wrist the crop came from.

    Prefers a detection whose reported handedness matches the side we cropped,
    then falls back to nearest-wrist. Detections whose wrist lands far from
    the pose wrist are rejected outright -- on wide grips the crop can catch a
    spotter, the rig, or the far hand.
    """

    if not hands:
        return None

    def distance(index: int) -> float:
        wrist = hands[index][HAND_WRIST]

        return (
            (wrist.x - target_wrist_x) ** 2
            + (wrist.y - target_wrist_y) ** 2
        ) ** 0.5

    matching = [
        index
        for index, (label, _score) in enumerate(hand_labels)
        if label == expected_label
    ]

    candidates = matching or list(range(len(hands)))

    best = min(candidates, key=distance)

    if distance(best) > max_distance:
        return None

    return best


class HandGripDetector:
    """
    Lazily runs MediaPipe Hand Landmarker on high-resolution crops
    around the pose wrists.

    The detector is lazy so analyzer unit tests that use synthetic
    frames do not need to initialize the hand model.
    """

    def __init__(
        self,
        *,
        model_path: Path,
        config: PullUpAnalyzerConfig,
    ) -> None:
        self.model_path = model_path
        self.config = config

        self._landmarker: vision.HandLandmarker | None = None
        self._next_sample_ms = 0.0

    def __enter__(self) -> Self:
        return self

    def __exit__(
        self,
        _exc_type: object,
        _exc_value: object,
        _traceback: object,
    ) -> None:
        self.close()

    def close(self) -> None:
        if self._landmarker is not None:
            self._landmarker.close()
            self._landmarker = None

    def observe(
        self,
        *,
        frame_bgr: np.ndarray,
        pose_landmarks: Sequence[PoseLandmark2D],
        timestamp_ms: int,
    ) -> GripObservation | None:
        if (
            not isinstance(frame_bgr, np.ndarray)
            or frame_bgr.size == 0
        ):
            return None

        if timestamp_ms + 1e-6 < self._next_sample_ms:
            return None

        self._next_sample_ms = (
            timestamp_ms
            + (1000.0 / self.config.target_hand_analysis_fps)
        )

        landmarker = self._get_landmarker()

        left_shoulder = pose_landmarks[LEFT_SHOULDER]
        right_shoulder = pose_landmarks[RIGHT_SHOULDER]

        shoulder_width_norm = abs(
            right_shoulder.x - left_shoulder.x
        )

        left_crop = self._crop_around_wrist(
            frame_bgr,
            pose_landmarks[LEFT_WRIST],
            left_shoulder,
            shoulder_width_norm,
        )
        right_crop = self._crop_around_wrist(
            frame_bgr,
            pose_landmarks[RIGHT_WRIST],
            right_shoulder,
            shoulder_width_norm,
        )

        left = self._detect_single_hand(
            landmarker,
            left_crop,
            body_side="left",
        )
        right = self._detect_single_hand(
            landmarker,
            right_crop,
            body_side="right",
        )

        grip = combine_hand_grips(
            left.label,
            right.label,
        )

        return GripObservation(
            timestamp_ms=timestamp_ms,
            grip=grip,
            left_grip=left.label,
            right_grip=right.label,
            left_score=left.score,
            right_score=right.score,
            left_hand_label=left.hand_label,
            right_hand_label=right.hand_label,
        )

    def _get_landmarker(
        self,
    ) -> vision.HandLandmarker:
        if self._landmarker is not None:
            return self._landmarker

        if not self.model_path.exists():
            raise FileNotFoundError(
                f"Hand model not found: {self.model_path}"
            )

        options = vision.HandLandmarkerOptions(
            base_options=mp.tasks.BaseOptions(
                model_asset_path=str(self.model_path),
            ),
            running_mode=vision.RunningMode.IMAGE,
            num_hands=2,
            min_hand_detection_confidence=(
                self.config.min_hand_detection_confidence
            ),
            min_hand_presence_confidence=(
                self.config.min_hand_presence_confidence
            ),
        )

        self._landmarker = (
            vision.HandLandmarker.create_from_options(options)
        )

        return self._landmarker

    def _crop_around_wrist(
        self,
        frame_bgr: np.ndarray,
        wrist_landmark: PoseLandmark2D,
        shoulder_landmark: PoseLandmark2D,
        shoulder_width_norm: float,
    ) -> HandCrop | None:
        height, width = frame_bgr.shape[:2]

        crop_size = int(
            np.clip(
                shoulder_width_norm
                * width
                * self.config.hand_crop_shoulder_multiplier,
                self.config.min_hand_crop_size_px,
                self.config.max_hand_crop_size_px,
            )
        )

        crop_size = max(1, min(crop_size, width, height))
        half = crop_size / 2.0

        wrist_x_px = wrist_landmark.x * width
        wrist_y_px = wrist_landmark.y * height

        # The hand sits beyond the pose wrist, along the forearm. The old
        # fixed "up by 0.015" offset only holds for a vertical forearm; on a
        # wide grip the forearm is diagonal, so a vertical nudge clips the
        # outer edge of the hand. Extending along shoulder -> wrist tracks
        # both cases.
        along_x = wrist_x_px - shoulder_landmark.x * width
        along_y = wrist_y_px - shoulder_landmark.y * height
        along_length = float(np.hypot(along_x, along_y))

        center_x = wrist_x_px
        center_y = wrist_y_px

        if along_length > 1e-6:
            offset = (
                crop_size
                * self.config.hand_crop_forward_offset_ratio
            )
            center_x += along_x / along_length * offset
            center_y += along_y / along_length * offset

        # Slide the window back inside the frame rather than truncating it.
        # A half-cropped hand makes MediaPipe extrapolate the missing
        # landmarks, and extrapolated MCPs are the single easiest way to
        # invert the winding.
        center_x = float(np.clip(center_x, half, width - half))
        center_y = float(np.clip(center_y, half, height - half))

        x1 = round(center_x - half)
        y1 = round(center_y - half)

        x1 = max(0, min(x1, width - crop_size))
        y1 = max(0, min(y1, height - crop_size))

        x2 = x1 + crop_size
        y2 = y1 + crop_size

        crop_width = x2 - x1
        crop_height = y2 - y1

        if crop_width <= 0 or crop_height <= 0:
            return None

        target_wrist_x = float(
            np.clip((wrist_x_px - x1) / crop_width, 0.0, 1.0)
        )
        target_wrist_y = float(
            np.clip((wrist_y_px - y1) / crop_height, 0.0, 1.0)
        )

        return HandCrop(
            image_bgr=frame_bgr[y1:y2, x1:x2].copy(),
            target_wrist_x=target_wrist_x,
            target_wrist_y=target_wrist_y,
            width_px=crop_width,
            height_px=crop_height,
        )

    def _detect_single_hand(
        self,
        landmarker: vision.HandLandmarker,
        crop: HandCrop | None,
        *,
        body_side: str,
    ) -> SingleHandGrip:
        if crop is None or crop.image_bgr.size == 0:
            return SingleHandGrip("not_detected", None, None, None)

        crop_rgb = cv2.cvtColor(
            crop.image_bgr,
            cv2.COLOR_BGR2RGB,
        )

        mp_image = mp.Image(
            image_format=mp.ImageFormat.SRGB,
            data=crop_rgb,
        )

        result = landmarker.detect(mp_image)

        hand_labels = read_hand_labels(result.handedness)

        index = select_hand_index(
            result.hand_landmarks,
            hand_labels,
            target_wrist_x=crop.target_wrist_x,
            target_wrist_y=crop.target_wrist_y,
            expected_label=expected_hand_label(
                body_side,
                hand_labels_are_mirrored=(
                    self.config.hand_labels_are_mirrored
                ),
            ),
            max_distance=(
                self.config.max_wrist_association_distance
            ),
        )

        if index is None:
            return SingleHandGrip("not_detected", None, None, None)

        hand_label, hand_label_score = hand_labels[index]

        if hand_label is None:
            return SingleHandGrip(
                "uncertain", None, None, None
            )

        # A bar occludes the thumb, which is the main cue MediaPipe uses to
        # tell a palm-toward from a palm-away hand. Low handedness confidence
        # means it guessed, and a guessed mirror is a guessed grip.
        if (
            hand_label_score
            < self.config.min_handedness_confidence
        ):
            return SingleHandGrip(
                "uncertain", None, hand_label, hand_label_score
            )

        label, score = classify_single_hand_grip(
            result.hand_landmarks[index],
            hand_label=hand_label,
            config=self.config,
            crop_width_px=float(crop.width_px),
            crop_height_px=float(crop.height_px),
        )

        return SingleHandGrip(
            label, score, hand_label, hand_label_score
        )