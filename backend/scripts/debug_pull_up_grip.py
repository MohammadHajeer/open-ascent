from __future__ import annotations

import argparse
from collections import Counter
from pathlib import Path

from app.analyzers.common.video import iter_pose_video_frames
from app.analyzers.pull_up.config import DEFAULT_PULL_UP_CONFIG
from app.analyzers.pull_up.grip import HandGripDetector

POSE_MODEL_PATH = Path("models/pose_landmarker_full.task")
HAND_MODEL_PATH = Path("models/hand_landmarker.task")


def _format_score(score: float | None) -> str:
    if score is None:
        return "None"

    return f"{score:+.3f}"


def main() -> None:
    parser = argparse.ArgumentParser(
        description=(
            "Inspect pull-up/chin-up grip observations while preserving "
            "the same hand-sampling schedule used by production analysis."
        )
    )
    parser.add_argument("video", type=Path)
    parser.add_argument("--start-ms", type=int, required=True)
    parser.add_argument("--end-ms", type=int, required=True)

    args = parser.parse_args()

    observations = []

    with HandGripDetector(
        model_path=HAND_MODEL_PATH,
        config=DEFAULT_PULL_UP_CONFIG,
    ) as grip_detector:
        for pose_frame in iter_pose_video_frames(
            args.video,
            pose_model_path=POSE_MODEL_PATH,
            target_fps=DEFAULT_PULL_UP_CONFIG.target_pose_fps,
            max_pose_dimension_px=DEFAULT_PULL_UP_CONFIG.max_pose_dimension_px,
        ):
            if pose_frame.landmarks is None:
                continue

            # Keep the exact same sampling timeline as production.
            # We call observe() for the whole video and only filter
            # what gets printed below.
            observation = grip_detector.observe(
                frame_bgr=pose_frame.frame_bgr,
                pose_landmarks=pose_frame.landmarks,
                timestamp_ms=pose_frame.timestamp_ms,
            )

            if observation is None:
                continue

            if not (
                args.start_ms
                <= observation.timestamp_ms
                <= args.end_ms
            ):
                continue

            observations.append(observation)

            print(
                f"{observation.timestamp_ms:5d} ms | "
                f"combined={observation.grip:10s} | "
                f"left={observation.left_grip:12s} "
                f"({_format_score(observation.left_score)}) | "
                f"right={observation.right_grip:12s} "
                f"({_format_score(observation.right_score)})"
            )

    print("\nSummary")
    print("-------")

    if not observations:
        print("No grip observations were produced.")
        return

    print("combined:", dict(Counter(item.grip for item in observations)))
    print("left:    ", dict(Counter(item.left_grip for item in observations)))
    print("right:   ", dict(Counter(item.right_grip for item in observations)))


if __name__ == "__main__":
    main()