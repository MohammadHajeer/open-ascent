import type { VerticalPullVariant } from "./vertical-pull-config.ts";

export type PoseLandmark = {
  x: number;
  y: number;
  z?: number;
  visibility?: number;
  presence?: number;
};

export type PullUpPhase =
  | "unknown"
  | "bottom"
  | "rising"
  | "top"
  | "lowering";

export type PullUpRepOutcome = "valid" | "partial" | "uncertain";

export type PullUpObservation = {
  timestampMs: number;
  angleDeg: number;
  bodyRelativeY: number;
  faceToWristY: number | null;
  minimumVisibility: number;
  handsAboveShoulders: boolean;
  bodyUnderHands: boolean;
  motionReady?: boolean;
  grip?: "pronated" | "supinated" | "unknown";
  width?: "close" | "standard" | "wide" | "unknown";
  widthRatio?: number | null;
  upperTorsoToWristRatio?: number | null;
  kneeAngleDeg?: number | null;
  hipHorizontalRatio?: number | null;
  ankleHorizontalRatio?: number | null;
};

export type PullUpRep = {
  index: number;
  outcome: PullUpRepOutcome;
  startMs: number;
  topMs: number | null;
  endMs: number;
  phases: PullUpPhase[];
  reasonCodes: string[];
  classification?: {
    grip: "pronated" | "supinated" | "unknown";
    width: "close" | "standard" | "wide" | "unknown";
    height: "standard" | "high" | "unknown";
    variant: VerticalPullVariant;
  };
};

export type PullUpSnapshot = {
  phase: PullUpPhase;
  validRepCount: number;
  partialRepCount: number;
  personDetected: boolean;
  poseReady: boolean;
  setupReady: boolean;
  startingPositionReady: boolean;
  latestRep: PullUpRep | null;
  variantBreakdown: Record<VerticalPullVariant, number>;
  observation: PullUpObservation | null;
  formFault?: "extend-at-bottom" | "excessive-knee-bend" | "body-swing" | null;
};

export type CueTone = "neutral" | "positive" | "attention";

export type LiveCoachCue = {
  id: string;
  priority: number;
  tone: CueTone;
  title: string;
  detail: string;
};
