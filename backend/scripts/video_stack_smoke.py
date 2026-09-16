from __future__ import annotations

from pathlib import Path

import cv2
import mediapipe as mp

TEST_VIDEO = Path(__file__).parent / "smoke-test.mp4"


def main() -> None:
    print(f"OpenCV version: {cv2.__version__}")
    print(f"MediaPipe version: {mp.__version__}")

    if not TEST_VIDEO.exists():
        raise FileNotFoundError(f"Test video not found: {TEST_VIDEO}")

    capture = cv2.VideoCapture(str(TEST_VIDEO))

    if not capture.isOpened():
        raise RuntimeError("OpenCV could not open the MP4 file.")

    fps = capture.get(cv2.CAP_PROP_FPS)
    frame_count = int(capture.get(cv2.CAP_PROP_FRAME_COUNT))
    width = int(capture.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(capture.get(cv2.CAP_PROP_FRAME_HEIGHT))

    print(f"Resolution: {width}x{height}")
    print(f"FPS: {fps}")
    print(f"Reported frame count: {frame_count}")

    decoded_frames = 0

    while decoded_frames < 30:
        success, frame = capture.read()

        if not success:
            break

        # This is the conversion our MediaPipe pipeline will commonly need.
        rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)

        if rgb_frame.size == 0:
            raise RuntimeError("Decoded frame was empty.")

        decoded_frames += 1

    capture.release()

    if decoded_frames == 0:
        raise RuntimeError("Video opened, but no frames could be decoded.")

    print(f"Decoded frames: {decoded_frames}")
    print("✅ OpenCV import works")
    print("✅ MediaPipe import works")
    print("✅ MP4 codec/decode works")
    print("✅ BGR → RGB conversion works")
    print("✅ Local video stack feasibility verified")


if __name__ == "__main__":
    main()
