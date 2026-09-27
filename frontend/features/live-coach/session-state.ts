import type { LiveCoachCue, LiveCoachMovement, PullUpSnapshot } from "./types.ts";
import { emptyVariantBreakdown } from "./vertical-pull-config.ts";

export type SessionStatus =
  | "idle"
  | "verifying-access"
  | "requesting-camera"
  | "loading-pose"
  | "running"
  | "stopped"
  | "error";

export type DeviceOption = { deviceId: string; label: string };

export const INITIAL_SNAPSHOT: PullUpSnapshot = {
  phase: "unknown",
  validRepCount: 0,
  partialRepCount: 0,
  personDetected: false,
  poseReady: false,
  setupReady: false,
  startingPositionReady: false,
  latestRep: null,
  variantBreakdown: emptyVariantBreakdown(),
  observation: null,
};

export const CAMERA_OFF_CUE: LiveCoachCue = {
  id: "camera-off",
  priority: 0,
  tone: "neutral",
  title: "Camera is off",
  detail: "Review safety, then start Live Coach when your bar and camera are ready.",
};

export function cameraOffCue(movement: LiveCoachMovement): LiveCoachCue {
  return movement === "push-up" ? {
    ...CAMERA_OFF_CUE,
    detail: "Review safety, then start with a side-view camera and clear floor space.",
  } : CAMERA_OFF_CUE;
}
