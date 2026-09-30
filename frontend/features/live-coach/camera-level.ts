import { POSE_INDEX, PULL_UP_SEMANTICS } from "./pull-up-semantics.ts";
import { aspectCorrected } from "./pose-geometry.ts";
import type { LiveCoachCue, PoseLandmark } from "./types.ts";

// Every analyzer reads image "down" as gravity. With the OS rotation lock on,
// a phone turned on its side delivers a sideways picture: the analyzers then
// fail safe (nothing arms or counts), but the athlete needs to know why.
//
// Only movements done upright (Pull-Up, Dip, Muscle-Up) can be checked: their
// torso always hangs shoulders-above-hips, so a torso lying across the frame
// for over a second means the picture, not the athlete, is sideways. A
// Push-Up plank on its side looks like standing, so it is never judged.

export const CAMERA_LEVEL = {
  // Torso this far from image-vertical (or upside down) reads as rotated;
  // back within uprightMaxTiltDeg reads upright. The gap is hysteresis.
  rotatedMinTiltDeg: 60,
  uprightMaxTiltDeg: 40,
  rotatedMinMs: 1200,
  rotatedMinSamples: 3,
  uprightMinSamples: 2,
  // Shorter than this (in frame heights), a torso direction is noise.
  minTorsoLength: 0.05,
  // Blind this long, earlier evidence no longer describes the camera.
  maxFrameGapMs: 600,
} as const;

export const CAMERA_ROTATED_CUE: LiveCoachCue = {
  id: "camera-rotated",
  priority: 95,
  tone: "attention",
  title: "Turn the phone upright",
  detail: "You appear sideways in the picture. Unlock screen rotation, or stand the phone so you appear upright, then hold your start position.",
};

/** Torso tilt from image-vertical in degrees: 0 upright, 90 lying across, 180 upside down. */
export function torsoTiltDeg(landmarks: readonly PoseLandmark[], aspectRatio: number): number | null {
  if (!Number.isFinite(aspectRatio) || aspectRatio <= 0) return null;
  const pairs = [
    [POSE_INDEX.leftShoulder, POSE_INDEX.leftHip],
    [POSE_INDEX.rightShoulder, POSE_INDEX.rightHip],
  ].filter(([shoulder, hip]) => [shoulder, hip].every((index) => {
    const point = landmarks[index];
    return point && Number.isFinite(point.x) && Number.isFinite(point.y) &&
      Math.min(point.visibility ?? 1, point.presence ?? 1) >= PULL_UP_SEMANTICS.minLandmarkVisibility;
  }));
  if (!pairs.length) return null;
  let dx = 0, dy = 0;
  for (const [shoulderIndex, hipIndex] of pairs) {
    const shoulder = aspectCorrected(landmarks[shoulderIndex], aspectRatio);
    const hip = aspectCorrected(landmarks[hipIndex], aspectRatio);
    dx += (hip.x - shoulder.x) / pairs.length;
    dy += (hip.y - shoulder.y) / pairs.length;
  }
  if (Math.hypot(dx, dy) < CAMERA_LEVEL.minTorsoLength) return null;
  return Math.atan2(Math.abs(dx), dy) * 180 / Math.PI;
}

/** Sustained evidence that the picture is sideways; brief poses never trigger it. */
export class CameraLevelMonitor {
  private rotated = false;
  private rotatedSince: number | null = null;
  private rotatedSamples = 0;
  private uprightSamples = 0;
  private lastSampleMs: number | null = null;

  get isRotated() { return this.rotated; }

  reset() {
    this.rotated = false;
    this.rotatedSince = null;
    this.rotatedSamples = 0;
    this.uprightSamples = 0;
    this.lastSampleMs = null;
  }

  update(landmarks: readonly PoseLandmark[] | null, timestampMs: number, aspectRatio: number) {
    const L = CAMERA_LEVEL;
    if (this.lastSampleMs !== null && timestampMs - this.lastSampleMs > L.maxFrameGapMs) {
      this.rotatedSince = null;
      this.rotatedSamples = 0;
      this.uprightSamples = 0;
    }
    const tilt = landmarks ? torsoTiltDeg(landmarks, aspectRatio) : null;
    // No usable torso: neither confirms nor clears.
    if (tilt === null) return this.rotated;
    this.lastSampleMs = timestampMs;
    if (tilt >= L.rotatedMinTiltDeg) {
      this.uprightSamples = 0;
      this.rotatedSince ??= timestampMs;
      this.rotatedSamples += 1;
      if (this.rotatedSamples >= L.rotatedMinSamples && timestampMs - this.rotatedSince >= L.rotatedMinMs) {
        this.rotated = true;
      }
    } else {
      this.rotatedSince = null;
      this.rotatedSamples = 0;
      if (tilt <= L.uprightMaxTiltDeg && ++this.uprightSamples >= L.uprightMinSamples) this.rotated = false;
    }
    return this.rotated;
  }
}
