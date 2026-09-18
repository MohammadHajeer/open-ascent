from __future__ import annotations

from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path

import cv2
import mediapipe as mp
import numpy as np
from mediapipe.tasks.python import vision


@dataclass(frozen=True, slots=True)
class PoseVideoFrame:
    timestamp_ms: int
    frame_bgr: np.ndarray
    landmarks: list | None


@dataclass(frozen=True, slots=True)
class VideoMetadata:
    fps: float
    frame_count: int
    duration_ms: int


class VideoReadError(Exception):
    pass


def get_video_metadata(
    video_path: Path,
) -> VideoMetadata:
    capture = cv2.VideoCapture(str(video_path))

    if not capture.isOpened():
        raise VideoReadError("Could not open video.")

    try:
        fps = float(capture.get(cv2.CAP_PROP_FPS))
        frame_count = int(capture.get(cv2.CAP_PROP_FRAME_COUNT))

        if fps <= 0:
            raise VideoReadError("Video has an invalid frame rate.")

        duration_ms = int((frame_count / fps) * 1000)

        return VideoMetadata(
            fps=fps,
            frame_count=frame_count,
            duration_ms=duration_ms,
        )

    finally:
        capture.release()


def resize_for_pose(
    frame: np.ndarray,
    *,
    max_dimension_px: int = 960,
) -> np.ndarray:
    """
    Resize while preserving the original aspect ratio.

    We avoid forcing every video into dimensions such as 540x960
    because that would distort landscape or differently shaped video.
    """

    height, width = frame.shape[:2]

    largest_dimension = max(height, width)

    if largest_dimension <= max_dimension_px:
        return frame

    scale = max_dimension_px / largest_dimension

    resized_width = max(1, round(width * scale))
    resized_height = max(1, round(height * scale))

    return cv2.resize(
        frame,
        (resized_width, resized_height),
        interpolation=cv2.INTER_AREA,
    )


def iter_pose_video_frames(
    video_path: Path,
    *,
    pose_model_path: Path,
    target_fps: float,
    max_pose_dimension_px: int = 960,
) -> Iterator[PoseVideoFrame]:
    if target_fps <= 0:
        raise ValueError("target_fps must be greater than zero.")

    if not pose_model_path.exists():
        raise FileNotFoundError(f"Pose model not found: {pose_model_path}")

    capture = cv2.VideoCapture(str(video_path))

    if not capture.isOpened():
        raise VideoReadError("Could not open video.")

    source_fps = float(capture.get(cv2.CAP_PROP_FPS))

    if source_fps <= 0:
        capture.release()

        raise VideoReadError("Video has an invalid frame rate.")

    options = vision.PoseLandmarkerOptions(
        base_options=mp.tasks.BaseOptions(
            model_asset_path=str(pose_model_path),
        ),
        running_mode=vision.RunningMode.VIDEO,
        num_poses=1,
    )

    # Example:
    #
    # target 30 FPS
    # → one analyzed frame every ~33.3 ms
    #
    # This makes sampling independent of whether the original
    # footage is 30, 60, 120 FPS, etc.
    sample_interval_ms = 1000.0 / min(
        target_fps,
        source_fps,
    )

    next_sample_ms = 0.0
    frame_number = 0

    try:
        with vision.PoseLandmarker.create_from_options(options) as landmarker:
            while True:
                success, original_frame = capture.read()

                if not success:
                    break

                timestamp_ms = frame_number * 1000.0 / source_fps

                frame_number += 1

                if timestamp_ms + 1e-6 < next_sample_ms:
                    continue

                next_sample_ms += sample_interval_ms

                pose_frame = resize_for_pose(
                    original_frame,
                    max_dimension_px=max_pose_dimension_px,
                )

                rgb_frame = cv2.cvtColor(
                    pose_frame,
                    cv2.COLOR_BGR2RGB,
                )

                mp_image = mp.Image(
                    image_format=mp.ImageFormat.SRGB,
                    data=rgb_frame,
                )

                detection = landmarker.detect_for_video(
                    mp_image,
                    round(timestamp_ms),
                )

                landmarks = None

                if detection.pose_landmarks:
                    landmarks = detection.pose_landmarks[0]

                yield PoseVideoFrame(
                    timestamp_ms=round(timestamp_ms),
                    frame_bgr=original_frame,
                    landmarks=landmarks,
                )

    finally:
        capture.release()
