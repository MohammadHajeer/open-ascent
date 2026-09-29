import { calculateAngle, POSE_INDEX, PULL_UP_SEMANTICS } from "./pull-up-semantics.ts";
import { INITIAL_SNAPSHOT } from "./session-state.ts";
import type { PoseLandmark, PullUpPhase, PullUpRep, PushUpObservation, PushUpSnapshot } from "./types.ts";

export const PUSH_UP_THRESHOLDS = {
  topAngleDeg: 160,
  leaveTopAngleDeg: 150,
  bottomAngleDeg: 95,
  // Live inference runs at ~12 fps (83-100 ms apart), and a brisk rep can
  // spend less than one frame interval past either endpoint. An endpoint is
  // reached by one sample past its threshold next to a sample within this
  // margin of it. No dwell is needed.
  endpointMarginDeg: 10,
  // The two samples must also agree: near a turnaround even a brisk rep moves
  // well under this per sample, while a one-frame landmark jump does not.
  endpointMaxStepDeg: 20,
  reversalDeltaDeg: 8,
  // Only arming asks the athlete to hold the top position.
  startHoldMs: 250,
  minStartSamples: 2,
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
  private holdSince: number | null = null;
  private holdSamples = 0;
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
    this.holdSince = null;
    this.holdSamples = 0;
    this.bottomMs = null;
    this.minimumAngle = 180;
    this.phases = [];
    this.bodyFaultSince = null;
    this.bodyFaultSamples = 0;
    this.fault = null;
    this.faultUntil = 0;
  }

  update(observation: PushUpObservation | null, timestampMs: number, personDetected = observation !== null): PushUpSnapshot {
    const T = PUSH_UP_THRESHOLDS;
    // A blind interval longer than maxFrameGapMs cannot complete a rep: discard
    // only the in-flight candidate, preserve totals, free the side lock, then
    // re-arm at a confirmed top.
    if (this.lastFrameMs !== null && timestampMs - this.lastFrameMs > T.maxFrameGapMs) {
      this.clearCycle();
      this.side = null;
      this.lastFrameMs = null;
    }
    // Skip a brief unusable frame (e.g. a folded elbow dipping below confidence
    // at the bottom, or the far arm standing in for one frame); samples either
    // side still count as consecutive.
    if (!observation || !observation.setupReady || (this.side !== null && observation.side !== this.side)) {
      return this.snapshot(observation, personDetected);
    }
    this.side = observation.side;
    this.lastFrameMs = timestampMs;
    const angle = observation.angleDeg;
    const previous = this.previousAngle;
    this.previousAngle = angle;
    // Mid-rep transitions need two consecutive agreeing samples, so a single
    // jittery elbow reading cannot start a rep or cue.
    const sustained = (holds: (value: number) => boolean) => previous !== null && holds(previous) && holds(angle);
    const atTop = angle >= T.topAngleDeg;
    const agrees = previous !== null && Math.abs(angle - previous) <= T.endpointMaxStepDeg;
    const reachedTop = agrees && sustained((value) => value >= T.topAngleDeg - T.endpointMarginDeg) &&
      Math.max(previous ?? angle, angle) >= T.topAngleDeg;
    const reachedBottom = agrees && sustained((value) => value <= T.bottomAngleDeg + T.endpointMarginDeg) &&
      Math.min(previous ?? angle, angle) <= T.bottomAngleDeg;

    if (this.phase === "unknown") {
      if (atTop) {
        this.holdSince ??= timestampMs;
        this.holdSamples += 1;
        if (this.holdSamples >= T.minStartSamples && timestampMs - this.holdSince >= T.startHoldMs) this.enterTop(timestampMs);
      } else {
        this.holdSince = null;
        this.holdSamples = 0;
      }
    } else if (this.phase === "top") {
      if (sustained((value) => value <= T.leaveTopAngleDeg)) {
        this.setPhase("lowering");
        this.startMs = timestampMs;
        this.minimumAngle = Math.min(previous ?? angle, angle);
        this.bottomMs = null;
      }
    }

    if (this.phase === "lowering" || this.phase === "bottom" || this.phase === "rising") {
      this.minimumAngle = Math.min(this.minimumAngle, angle);
      if (reachedBottom && this.bottomMs === null) {
        this.bottomMs = timestampMs;
        this.setPhase("bottom");
      }
      if (this.phase !== "rising" && sustained((value) => value >= this.minimumAngle + T.reversalDeltaDeg)) {
        this.setPhase("rising");
        this.upwardPeak = angle;
        this.progressMs = timestampMs;
        if (this.bottomMs === null) this.setFault("go-lower", timestampMs);
      }
      if (this.phase === "rising") {
        if (angle >= this.upwardPeak + T.extensionProgressDeg) {
          this.upwardPeak = angle;
          this.progressMs = timestampMs;
        }
        if (!atTop && this.upwardPeak >= T.extensionCueMinAngleDeg &&
          (timestampMs - this.progressMs >= T.extensionPersistMs ||
            sustained((value) => value <= this.upwardPeak - T.reversalDeltaDeg))) {
          this.setFault("extend-arms", timestampMs);
        }
      }
      if (reachedTop) {
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
    const bentBody = this.phase !== "unknown" && observation.bodyAngleDeg < T.bodyAngleMinDeg;
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
