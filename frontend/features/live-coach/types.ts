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
};

export type PullUpRep = {
  index: number;
  outcome: PullUpRepOutcome;
  startMs: number;
  topMs: number | null;
  endMs: number;
  phases: PullUpPhase[];
  reasonCodes: string[];
};

export type PullUpSnapshot = {
  phase: PullUpPhase;
  validRepCount: number;
  partialRepCount: number;
  poseReady: boolean;
  setupReady: boolean;
  latestRep: PullUpRep | null;
  observation: PullUpObservation | null;
};

export type CueTone = "neutral" | "positive" | "attention";

export type LiveCoachCue = {
  id: string;
  priority: number;
  tone: CueTone;
  title: string;
  detail: string;
};

