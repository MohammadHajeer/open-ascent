import type { PoseLandmark, PullUpObservation } from "./types.ts";
import { VARIANT_EVIDENCE } from "./vertical-pull-config.ts";

// These definitions and thresholds intentionally match the Python pull-up
// analyzer in backend/app/analyzers/pull_up/{config,measurements,evidence}.py.
export const PULL_UP_SEMANTICS = {
  bottomAngleDeg: 145,
  topAngleDeg: 50,
  partialTopAngleDeg: 90,
  faceAssistedTopMaxAngleDeg: 120,
  faceToWristTopTolerance: 0.01,
  faceAssistedTopMinBodyRiseRatio: 0.35,
  motionAngleDeltaDeg: 4,
  repStartBodyRiseThreshold: 0.008,
  hangConfirmationMs: 350,
  invalidPositionToleranceMs: 120,
  // The shoulders must return near their anchored wrist-relative start height
  // before a full rep completes; allow modest pose jitter in normalized units.
  repReturnBodyTolerance: 0.06,
  bodyAlignmentTolerance: 0.15,
  minLandmarkVisibility: 0.5,
} as const;

export const POSE_INDEX = {
  mouthLeft: 9,
  mouthRight: 10,
  leftShoulder: 11,
  rightShoulder: 12,
  leftElbow: 13,
  rightElbow: 14,
  leftWrist: 15,
  rightWrist: 16,
  leftHip: 23,
  rightHip: 24,
  leftPinky: 17,
  rightPinky: 18,
  leftIndex: 19,
  rightIndex: 20,
  leftKnee: 25,
  rightKnee: 26,
  leftAnkle: 27,
  rightAnkle: 28,
} as const;

const REQUIRED_INDEXES = [
  POSE_INDEX.leftShoulder,
  POSE_INDEX.rightShoulder,
  POSE_INDEX.leftElbow,
  POSE_INDEX.rightElbow,
  POSE_INDEX.leftWrist,
  POSE_INDEX.rightWrist,
  POSE_INDEX.leftHip,
  POSE_INDEX.rightHip,
] as const;

function visibility(landmark: PoseLandmark) {
  return Math.min(landmark.visibility ?? 1, landmark.presence ?? 1);
}

function visible(landmarks: readonly PoseLandmark[], indexes: readonly number[], minimum = 0.7) {
  return indexes.every((index) => landmarks[index] && visibility(landmarks[index]) >= minimum);
}

// Pose's few hand points do not resolve palm direction on an occluded bar.
// Keep this unknown until a reliable automatic hand signal is available.
export function classifyPoseGrip(landmarks: readonly PoseLandmark[]): "unknown" {
  void landmarks;
  return "unknown";
}

export function handWidthRatio(landmarks: readonly PoseLandmark[]): number | null {
  if (!visible(landmarks, [11, 12, 15, 16, 23, 24], 0.55)) return null;
  const shoulderSpan = Math.abs(landmarks[12].x - landmarks[11].x);
  const wristSpan = Math.abs(landmarks[16].x - landmarks[15].x);
  const shoulderY = (landmarks[11].y + landmarks[12].y) / 2;
  const hipY = (landmarks[23].y + landmarks[24].y) / 2;
  const torsoSpan = Math.abs(hipY - shoulderY);
  // Relative proportions reject an edge-on torso or collapsed wrist track.
  if (torsoSpan <= 0 || shoulderSpan / torsoSpan < 0.35 || wristSpan / torsoSpan < 0.15) return null;
  return wristSpan / shoulderSpan;
}

export function classifyHandWidth(landmarks: readonly PoseLandmark[]) {
  const ratio = handWidthRatio(landmarks);
  if (ratio === null) return "unknown";
  if (ratio <= VARIANT_EVIDENCE.closeWidthRatioMax) return "close";
  if (ratio >= VARIANT_EVIDENCE.wideWidthRatioMin) return "wide";
  if (ratio >= VARIANT_EVIDENCE.standardWidthRatioMin && ratio <= VARIANT_EVIDENCE.standardWidthRatioMax) return "standard";
  return "unknown";
}

export function calculateAngle(
  first: PoseLandmark,
  vertex: PoseLandmark,
  third: PoseLandmark,
) {
  const vectorA = { x: first.x - vertex.x, y: first.y - vertex.y };
  const vectorB = { x: third.x - vertex.x, y: third.y - vertex.y };
  const magnitudeA = Math.hypot(vectorA.x, vectorA.y);
  const magnitudeB = Math.hypot(vectorB.x, vectorB.y);

  if (magnitudeA <= 1e-9 || magnitudeB <= 1e-9) return null;

  const cosine = Math.max(
    -1,
    Math.min(
      1,
      (vectorA.x * vectorB.x + vectorA.y * vectorB.y) /
        (magnitudeA * magnitudeB),
    ),
  );

  return (Math.acos(cosine) * 180) / Math.PI;
}

export function measurePullUpPose(
  landmarks: readonly PoseLandmark[],
  timestampMs: number,
): PullUpObservation | null {
  if (landmarks.length <= Math.max(...REQUIRED_INDEXES)) return null;

  const minimumVisibility = Math.min(
    ...REQUIRED_INDEXES.map((index) => visibility(landmarks[index])),
  );
  if (minimumVisibility < PULL_UP_SEMANTICS.minLandmarkVisibility) return null;

  const leftAngle = calculateAngle(
    landmarks[POSE_INDEX.leftShoulder],
    landmarks[POSE_INDEX.leftElbow],
    landmarks[POSE_INDEX.leftWrist],
  );
  const rightAngle = calculateAngle(
    landmarks[POSE_INDEX.rightShoulder],
    landmarks[POSE_INDEX.rightElbow],
    landmarks[POSE_INDEX.rightWrist],
  );
  if (leftAngle === null || rightAngle === null) return null;

  const leftShoulder = landmarks[POSE_INDEX.leftShoulder];
  const rightShoulder = landmarks[POSE_INDEX.rightShoulder];
  const leftWrist = landmarks[POSE_INDEX.leftWrist];
  const rightWrist = landmarks[POSE_INDEX.rightWrist];
  const leftHip = landmarks[POSE_INDEX.leftHip];
  const rightHip = landmarks[POSE_INDEX.rightHip];
  const wristCenterX = (leftWrist.x + rightWrist.x) / 2;
  const wristCenterY = (leftWrist.y + rightWrist.y) / 2;
  const shoulderCenterY = (leftShoulder.y + rightShoulder.y) / 2;
  const hipCenterX = (leftHip.x + rightHip.x) / 2;
  const hipCenterY = (leftHip.y + rightHip.y) / 2;
  const torsoSpan = hipCenterY - shoulderCenterY;
  const kneesAndAnklesVisible = visible(landmarks, [23, 24, 25, 26, 27, 28]);
  const kneeAngles = kneesAndAnklesVisible ? [
    calculateAngle(landmarks[23], landmarks[25], landmarks[27]),
    calculateAngle(landmarks[24], landmarks[26], landmarks[28]),
  ] : null;
  const ankleCenterX = kneesAndAnklesVisible
    ? (landmarks[27].x + landmarks[28].x) / 2 : null;

  const faceVisible =
    landmarks.length > POSE_INDEX.mouthRight &&
    visibility(landmarks[POSE_INDEX.mouthLeft]) >=
      PULL_UP_SEMANTICS.minLandmarkVisibility &&
    visibility(landmarks[POSE_INDEX.mouthRight]) >=
      PULL_UP_SEMANTICS.minLandmarkVisibility;
  const faceToWristY = faceVisible
    ? (landmarks[POSE_INDEX.mouthLeft].y +
        landmarks[POSE_INDEX.mouthRight].y) /
        2 -
      wristCenterY
    : null;

  return {
    timestampMs,
    angleDeg: (leftAngle + rightAngle) / 2,
    bodyRelativeY: shoulderCenterY - wristCenterY,
    faceToWristY,
    minimumVisibility,
    handsAboveShoulders:
      leftWrist.y < leftShoulder.y && rightWrist.y < rightShoulder.y,
    bodyUnderHands:
      wristCenterY < shoulderCenterY &&
      shoulderCenterY < hipCenterY &&
      Math.abs(hipCenterX - wristCenterX) <
        PULL_UP_SEMANTICS.bodyAlignmentTolerance,
    motionReady: shoulderCenterY < hipCenterY &&
      Math.abs(hipCenterX - wristCenterX) < PULL_UP_SEMANTICS.bodyAlignmentTolerance,
    grip: classifyPoseGrip(landmarks),
    width: classifyHandWidth(landmarks),
    widthRatio: handWidthRatio(landmarks),
    // Upper torso proxy relative to the wrist line; no bar is detected.
    upperTorsoToWristRatio: torsoSpan > VARIANT_EVIDENCE.minTorsoSpanForHeight
      ? (shoulderCenterY + 0.25 * torsoSpan - wristCenterY) / torsoSpan : null,
    kneeAngleDeg: kneeAngles?.every((angle) => angle !== null)
      ? Math.min(...kneeAngles as number[]) : null,
    hipHorizontalRatio: kneesAndAnklesVisible && torsoSpan > 0.08
      ? (hipCenterX - wristCenterX) / torsoSpan : null,
    ankleHorizontalRatio: ankleCenterX !== null && torsoSpan > 0.08
      ? (ankleCenterX - wristCenterX) / torsoSpan : null,
  };
}
