import type { LiveCoachCue, LiveCoachMovement, PullUpSnapshot } from "./types.ts";
import { emptyVariantBreakdown } from "./vertical-pull-config.ts";

export type SessionStatus =
  | "idle"
  | "verifying-access"
  | "requesting-camera"
  | "checking-camera"
  | "loading-pose"
  | "running"
  | "stopped"
  | "error";

export type DeviceOption = { deviceId: string; label: string };

/** What the running camera delivers, and the mode it was opened in. */
export type CameraInfo = {
  label: string;
  width: number | null;
  height: number | null;
  frameRate: number | null;
  tier: string;
};

/**
 * Names cameras for the selector. Enumeration before permission returns blank
 * ids and labels, so those entries are dropped; repeated labels get a suffix.
 */
export function cameraOptions(devices: Pick<MediaDeviceInfo, "deviceId" | "kind" | "label">[]): DeviceOption[] {
  const inputs = devices.filter((device) => device.kind === "videoinput" && device.deviceId);
  const seen = new Map<string, number>();
  return inputs.map((device, index) => {
    const base = device.label.trim() || `Camera ${index + 1}`;
    const count = (seen.get(base) ?? 0) + 1;
    seen.set(base, count);
    return { deviceId: device.deviceId, label: count > 1 ? `${base} (${count})` : base };
  });
}

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
  if (movement === "dips") return {
    ...CAMERA_OFF_CUE,
    detail: "Review safety, then start with a side-view camera that sees your shoulder, elbow, wrist, hip, and parallel bars.",
  };
  if (movement === "muscle-up") return {
    ...CAMERA_OFF_CUE,
    detail: "Review safety, then start with a side-view camera that sees you above and below the bar.",
  };
  return movement === "push-up" ? {
    ...CAMERA_OFF_CUE,
    detail: "Review safety, then start with a side-view camera and clear floor space.",
  } : CAMERA_OFF_CUE;
}
