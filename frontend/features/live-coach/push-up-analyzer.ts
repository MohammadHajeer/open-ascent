import { calculateAngle, POSE_INDEX, PULL_UP_SEMANTICS } from "./pull-up-semantics.ts";
import { INITIAL_SNAPSHOT } from "./session-state.ts";
import type { PoseLandmark, PullUpPhase, PullUpRep, PushUpObservation, PushUpSnapshot } from "./types.ts";

export const PUSH_UP_THRESHOLDS = {
  topAngleDeg: 160,
  leaveTopAngleDeg: 150,
  bottomAngleDeg: 95,
  reversalDeltaDeg: 8,
  // Live inference runs at ~12 fps (83-100 ms apart), so two consecutive
  // samples must always satisfy this; 100 ms silently required three.
  confirmationMs: 60,
  startHoldMs: 250,
  minConfirmationSamples: 2,
  bodyAngleMinDeg: 150,
  bodyFaultPersistMs: 600,
  bodyFaultMinSamples: 3,
  extensionPersistMs: 1000,
  extensionProgressDeg: 4,
  extensionCueMinAngleDeg: 115,
  cueHoldMs: 2500,
  maxFrameGapMs: 600,
} as const;

const SIDES = {
  left: [POSE_INDEX.leftShoulder, POSE_INDEX.leftElbow, POSE_INDEX.leftWrist, POSE_INDEX.leftHip, POSE_INDEX.leftAnkle],
  right: [POSE_INDEX.rightShoulder, POSE_INDEX.rightElbow, POSE_INDEX.rightWrist, POSE_INDEX.rightHip, POSE_INDEX.rightAnkle],
} as const;

// Normalized x/y have different scales on a non-square video. Correct x before
// reusing the existing 2D angle utility; preview mirroring never affects logic.
export function measurePushUpPose(
  landmarks: readonly PoseLandmark[], timestampMs: number,
  aspectRatio = 1, preferredSide: PushUpObservation["side"] | null = null,
): PushUpObservation | null {
  if (!Number.isFinite(aspectRatio) || aspectRatio <= 0) return null;
  const candidates = (["left", "right"] as const).flatMap((side) => {
    const points = SIDES[side].map((index) => landmarks[index]);
    if (points.some((point) => !point || !Number.isFinite(point.x) || !Number.isFinite(point.y))) return [];
    const minimumVisibility = Math.min(...points.map((point) => Math.min(point.visibility ?? 1, point.presence ?? 1)));
    if (!Number.isFinite(minimumVisibility) || minimumVisibility < PULL_UP_SEMANTICS.minLandmarkVisibility) return [];
    const [shoulder, elbow, wrist, hip, ankle] = points.map((point) => ({ ...point, x: point.x * aspectRatio }));
    const angleDeg = calculateAngle(shoulder, elbow, wrist);
    const bodyAngleDeg = calculateAngle(shoulder, hip, ankle);
    if (angleDeg === null || bodyAngleDeg === null) return [];
    // Side-view plank, rather than standing elbow curls. Body-line faults do
    // not invalidate reps: only a clearly unsuitable camera/setup does.
    const setupReady = Math.abs(ankle.x - shoulder.x) > Math.abs(ankle.y - shoulder.y) &&
      wrist.y > shoulder.y && Math.hypot(hip.x - shoulder.x, hip.y - shoulder.y) > 0.05;
    return [{ timestampMs, angleDeg, bodyAngleDeg, minimumVisibility, side, setupReady }];
  });
  // Keep the initially stronger side while reliable, avoiding angle jumps.
  return candidates.find((item) => item.side === preferredSide) ??
    candidates.sort((a, b) => b.minimumVisibility - a.minimumVisibility)[0] ?? null;
}

export class LivePushUpAnalyzer {
  private phase: PullUpPhase = "unknown";
  private count = 0;
  private partial = 0;
  private repIndex = 0;
  private latestRep: PullUpRep | null = null;
  private side: PushUpObservation["side"] | null = null;
  private lastFrameMs: number | null = null;
  private previousAngle: number | null = null;
  private boundary: "top" | "bottom" | null = null;
  private boundarySince = 0;
  private boundarySamples = 0;
  private startMs = 0;
  private bottomMs: number | null = null;
  private minimumAngle = 180;
  private upwardPeak = 0;
  private progressMs = 0;
  private bodyFaultSince: number | null = null;
  private bodyFaultSamples = 0;
  private fault: PushUpSnapshot["formFault"] = null;
  private faultUntil = 0;
  private phases: PullUpPhase[] = [];

  get selectedSide() { return this.side; }

  reset() {
    this.count = 0;
    this.partial = 0;
    this.repIndex = 0;
    this.latestRep = null;
    this.side = null;
    this.lastFrameMs = null;
    this.clearCycle();
  }

  private clearCycle() {
    this.phase = "unknown";
    this.previousAngle = null;
    this.boundary = null;
    this.boundarySamples = 0;
    this.bottomMs = null;
    this.minimumAngle = 180;
    this.phases = [];
    this.bodyFaultSince = null;
    this.bodyFaultSamples = 0;
    this.fault = null;
    this.faultUntil = 0;
  }

  update(observation: PushUpObservation | null, timestampMs: number, personDetected = observation !== null): PushUpSnapshot {
    // Skip a brief unusable frame (e.g. a folded elbow dipping below confidence
    // at the bottom); samples either side still count as consecutive. A blind
    // interval longer than maxFrameGapMs cannot complete a rep: discard only the
    // in-flight candidate, preserve totals, then re-arm at a confirmed top.
    if (!observation || !observation.setupReady) {
      if (this.lastFrameMs === null || timestampMs - this.lastFrameMs > PUSH_UP_THRESHOLDS.maxFrameGapMs) {
        this.clearCycle();
        this.lastFrameMs = null;
      }
      return this.snapshot(observation, personDetected);
    }
    if ((this.lastFrameMs !== null && timestampMs - this.lastFrameMs > PUSH_UP_THRESHOLDS.maxFrameGapMs) ||
      (this.side !== null && observation.side !== this.side)) this.clearCycle();
    this.side = observation.side;
    this.lastFrameMs = timestampMs;
    const angle = observation.angleDeg;
    const previous = this.previousAngle;
    this.previousAngle = angle;
    // Like endpoints, mid-rep transitions need two consecutive agreeing
    // samples, so a single jittery elbow reading cannot start a rep or cue.
    const sustained = (holds: (value: number) => boolean) => previous !== null && holds(previous) && holds(angle);
    const atTop = angle >= PUSH_UP_THRESHOLDS.topAngleDeg;
    const atBottom = angle <= PUSH_UP_THRESHOLDS.bottomAngleDeg;
    const boundary = atTop ? "top" : atBottom ? "bottom" : null;
    if (boundary !== this.boundary) {
      this.boundary = boundary;
      this.boundarySince = timestampMs;
      this.boundarySamples = 0;
    }
    this.boundarySamples += 1;
    const confirmed = this.boundarySamples >= PUSH_UP_THRESHOLDS.minConfirmationSamples &&
      timestampMs - this.boundarySince >= (this.phase === "unknown" ? PUSH_UP_THRESHOLDS.startHoldMs : PUSH_UP_THRESHOLDS.confirmationMs);

    if (this.phase === "unknown") {
      if (atTop && confirmed) this.enterTop(timestampMs);
    } else if (this.phase === "top") {
      if (sustained((value) => value <= PUSH_UP_THRESHOLDS.leaveTopAngleDeg)) {
        this.setPhase("lowering");
        this.startMs = timestampMs;
        this.minimumAngle = Math.min(previous ?? angle, angle);
        this.bottomMs = null;
      }
    }

    if (this.phase === "lowering" || this.phase === "bottom" || this.phase === "rising") {
      this.minimumAngle = Math.min(this.minimumAngle, angle);
      if (atBottom && confirmed && this.bottomMs === null) {
        this.bottomMs = timestampMs;
        this.setPhase("bottom");
      }
      if (this.phase !== "rising" && sustained((value) => value >= this.minimumAngle + PUSH_UP_THRESHOLDS.reversalDeltaDeg)) {
        this.setPhase("rising");
        this.upwardPeak = angle;
        this.progressMs = timestampMs;
        if (this.bottomMs === null) this.setFault("go-lower", timestampMs);
      }
      if (this.phase === "rising") {
        if (angle >= this.upwardPeak + PUSH_UP_THRESHOLDS.extensionProgressDeg) {
          this.upwardPeak = angle;
          this.progressMs = timestampMs;
        }
        if (!atTop && this.upwardPeak >= PUSH_UP_THRESHOLDS.extensionCueMinAngleDeg &&
          (timestampMs - this.progressMs >= PUSH_UP_THRESHOLDS.extensionPersistMs ||
            sustained((value) => value <= this.upwardPeak - PUSH_UP_THRESHOLDS.reversalDeltaDeg))) {
          this.setFault("extend-arms", timestampMs);
        }
      }
      if (atTop && confirmed) {
        const valid = this.bottomMs !== null;
        if (valid) this.count += 1;
        else this.partial += 1;
        this.setPhase("top");
        this.latestRep = {
          index: ++this.repIndex, outcome: valid ? "valid" : "partial",
          startMs: this.startMs, topMs: timestampMs, endMs: timestampMs,
          phases: [...this.phases], reasonCodes: valid ? [] : ["did_not_reach_bottom"],
        };
        if (valid) { this.fault = null; this.faultUntil = 0; }
        else this.setFault("go-lower", timestampMs);
        this.enterTop(timestampMs);
      }
    }

    // Getting into position is never a body-line fault; track only once armed.
    const bentBody = this.phase !== "unknown" && observation.bodyAngleDeg < PUSH_UP_THRESHOLDS.bodyAngleMinDeg;
    if (bentBody) {
      this.bodyFaultSince ??= timestampMs;
      this.bodyFaultSamples += 1;
    } else {
      this.bodyFaultSince = null;
      this.bodyFaultSamples = 0;
    }
    return this.snapshot(observation, personDetected);
  }

  private enterTop(timestampMs: number) {
    this.phase = "top";
    this.phases = ["top"];
    this.startMs = timestampMs;
    this.bottomMs = null;
    this.minimumAngle = 180;
  }

  private setPhase(phase: PullUpPhase) {
    if (this.phase !== phase) this.phases.push(phase);
    this.phase = phase;
  }

  private setFault(fault: PushUpSnapshot["formFault"], timestampMs: number) {
    this.fault = fault;
    this.faultUntil = timestampMs + PUSH_UP_THRESHOLDS.cueHoldMs;
  }

  private snapshot(observation: PushUpObservation | null, personDetected: boolean): PushUpSnapshot {
    const now = observation?.timestampMs ?? 0;
    // Surface the body-line cue only mid-rep, not while resting at the top.
    const inRep = this.phase === "lowering" || this.phase === "bottom" || this.phase === "rising";
    const bodyFault = inRep && this.bodyFaultSince !== null && this.bodyFaultSamples >= PUSH_UP_THRESHOLDS.bodyFaultMinSamples &&
      now - this.bodyFaultSince >= PUSH_UP_THRESHOLDS.bodyFaultPersistMs;
    const formFault = now < this.faultUntil ? this.fault : bodyFault ? "body-straight" : null;
    return {
      ...INITIAL_SNAPSHOT, phase: this.phase, validRepCount: this.count,
      partialRepCount: this.partial, latestRep: this.latestRep, observation,
      personDetected, poseReady: observation !== null, setupReady: observation?.setupReady ?? false,
      startingPositionReady: this.phase !== "unknown",
      formFault: observation?.setupReady ? formFault : null,
    };
  }
}
