import type { PoseLandmark } from "../types.ts";

type FixtureOptions = {
  elbowAngleDeg: number;
  wristY?: number;
  mouthY?: number;
  visibility?: number;
};

// Deterministic 33-point fixture using the same MediaPipe landmark indexes as
// the Python analyzer. The shoulder/elbow/wrist triangle is constructed so the
// requested elbow angle can be checked by either implementation.
export function pullUpLandmarkFixture({
  elbowAngleDeg,
  wristY = 0.15,
  mouthY = 0.3,
  visibility = 0.99,
}: FixtureOptions): PoseLandmark[] {
  const landmarks = Array.from({ length: 33 }, () => ({
    x: 0.5,
    y: 0.5,
    z: 0,
    visibility,
    presence: visibility,
  }));
  const radians = (elbowAngleDeg * Math.PI) / 180;
  const limbLength = 0.2;
  const elbowY = wristY + limbLength;
  const horizontal = Math.sin(radians) * limbLength;
  const vertical = Math.cos(radians) * limbLength;

  landmarks[9] = { ...landmarks[9], x: 0.48, y: mouthY };
  landmarks[10] = { ...landmarks[10], x: 0.52, y: mouthY };
  landmarks[13] = { ...landmarks[13], x: 0.38, y: elbowY };
  landmarks[14] = { ...landmarks[14], x: 0.62, y: elbowY };
  landmarks[15] = { ...landmarks[15], x: 0.38, y: wristY };
  landmarks[16] = { ...landmarks[16], x: 0.62, y: wristY };
  landmarks[11] = {
    ...landmarks[11],
    x: 0.38 + horizontal,
    y: elbowY - vertical,
  };
  landmarks[12] = {
    ...landmarks[12],
    x: 0.62 - horizontal,
    y: elbowY - vertical,
  };
  const shoulderY = (landmarks[11].y + landmarks[12].y) / 2;
  landmarks[23] = { ...landmarks[23], x: 0.48, y: shoulderY + 0.22 };
  landmarks[24] = { ...landmarks[24], x: 0.52, y: shoulderY + 0.22 };
  return landmarks;
}

