import { calculateAngle, POSE_INDEX, PULL_UP_SEMANTICS } from "./pull-up-semantics.ts";
import { INITIAL_SNAPSHOT } from "./session-state.ts";
import type { DipObservation, DipSnapshot, PoseLandmark, PullUpPhase, PullUpRep } from "./types.ts";

export const DIP_THRESHOLDS = {
  topAngleDeg: 160,
  leaveTopAngleDeg: 150,
  bottomAngleDeg: 95,
  // A fast dip that bounces at the bottom can leave only one 12 fps sample
  // past bottomAngleDeg; the adjacent sample must still be within this.
  bottomNeighborMarginDeg: 8,
  // Likewise, back-to-back dips pass through lockout without pausing, so the
  // top needs one supported sample past topAngleDeg next to one within this.
  topNeighborMarginDeg: 8,
  // Both endpoint samples must agree: near a turnaround even a brisk dip moves
  // well under this per sample, while a one-frame landmark jump does not.
  endpointMaxStepDeg: 20,
  reversalDeltaDeg: 8,
  // Only arming asks the athlete to hold top support.
  startHoldMs: 250,
  minStartSamples: 2,
  // Straight-arm support puts the hip joint ~0.14 arm lengths above the
  // wrist, more with active shoulders or a high camera. This only rejects
  // plank/hang-like poses: standing with arms down looks identical, so the
  // hands-on-bars check below is what rejects floor movement.
  minHipBelowWristArmLengths: -0.35,
  minShoulderAboveWristArmLengths: 0.45,
  // Once armed, hands stay on the bars: a wrist this far from its position at
  // the confirmed top means the athlete gripped, released, or is standing.
  barToleranceArmLengths: 0.25,
  extensionCueMinAngleDeg: 115,
  extensionPersistMs: 1000,
  extensionProgressDeg: 4,
  cueHoldMs: 2500,
  maxFrameGapMs: 600,
} as const;

const SIDES = {
  left: [POSE_INDEX.leftShoulder, POSE_INDEX.leftElbow, POSE_INDEX.leftWrist, POSE_INDEX.leftHip],
  right: [POSE_INDEX.rightShoulder, POSE_INDEX.rightElbow, POSE_INDEX.rightWrist, POSE_INDEX.rightHip],
} as const;

/** One visible arm in a side or mostly-side view; mirror preview does not affect measurements. */
export function measureDipPose(
  landmarks: readonly PoseLandmark[], timestampMs: number,
  aspectRatio = 1, preferredSide: DipObservation["side"] | null = null,
): DipObservation | null {
  if (!Number.isFinite(aspectRatio) || aspectRatio <= 0) return null;
  const candidates = (["left", "right"] as const).flatMap((side) => {
    const points = SIDES[side].map((index) => landmarks[index]);
    if (points.some((point) => !point || !Number.isFinite(point.x) || !Number.isFinite(point.y))) return [];
    const minimumVisibility = Math.min(...points.map((point) => Math.min(point.visibility ?? 1, point.presence ?? 1)));
    if (!Number.isFinite(minimumVisibility) || minimumVisibility < PULL_UP_SEMANTICS.minLandmarkVisibility) return [];
    const [shoulder, elbow, wrist, hip] = points.map((point) => ({ ...point, x: point.x * aspectRatio }));
    const angleDeg = calculateAngle(shoulder, elbow, wrist);
    if (angleDeg === null) return [];
    const armLength = Math.hypot(shoulder.x - elbow.x, shoulder.y - elbow.y) +
      Math.hypot(elbow.x - wrist.x, elbow.y - wrist.y);
    const supportReady = (wrist.y - shoulder.y) / armLength >= DIP_THRESHOLDS.minShoulderAboveWristArmLengths &&
      (hip.y - wrist.y) / armLength >= DIP_THRESHOLDS.minHipBelowWristArmLengths &&
      hip.y > shoulder.y;
    return [{ timestampMs, angleDeg, minimumVisibility, side, supportReady, wristX: wrist.x, wristY: wrist.y, armLength }];
  });
  return candidates.find((item) => item.side === preferredSide) ??
    candidates.sort((a, b) => b.minimumVisibility - a.minimumVisibility)[0] ?? null;
}

/** TOP SUPPORT → LOWERING → BOTTOM → PRESSING UP → TOP SUPPORT. */
export class LiveDipAnalyzer {
  private phase: PullUpPhase = "unknown";
  private count = 0;
  private partial = 0;
  private repIndex = 0;
  private latestRep: PullUpRep | null = null;
  private side: DipObservation["side"] | null = null;
  private lastFrameMs: number | null = null;
  private previousAngle: number | null = null;
  private previousSupported = false;
  private holdSince: number | null = null;
  private holdSamples = 0;
  private startMs = 0;
  private bottomMs: number | null = null;
  private minimumAngle = 180;
  private upwardPeak = 0;
  private progressMs = 0;
  private phases: PullUpPhase[] = [];
  private fault: DipSnapshot["formFault"] = null;
  private faultUntil = 0;
  private bars: { x: number; y: number; armLength: number } | null = null;

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
    this.previousSupported = false;
    this.holdSince = null;
    this.holdSamples = 0;
    this.bottomMs = null;
    this.minimumAngle = 180;
    this.phases = [];
    this.fault = null;
    this.faultUntil = 0;
    this.bars = null;
  }

  private onBars(observation: DipObservation) {
    return this.bars === null || Math.hypot(observation.wristX - this.bars.x, observation.wristY - this.bars.y) <=
      DIP_THRESHOLDS.barToleranceArmLengths * this.bars.armLength;
  }

  update(observation: DipObservation | null, timestampMs: number, personDetected = observation !== null): DipSnapshot {
    const T = DIP_THRESHOLDS;
    // A substantial blind gap discards only the unfinished candidate, never
    // completed totals, and frees the side lock and bar position.
    if (this.lastFrameMs !== null && timestampMs - this.lastFrameMs > T.maxFrameGapMs) {
      this.clearCycle();
      this.side = null;
      this.lastFrameMs = null;
    }
    // Skip a missing frame, the other arm standing in for a briefly unusable
    // locked arm, or hands off the bars; samples either side stay consecutive.
    const onBars = observation !== null && this.onBars(observation);
    if (!observation || !onBars || (this.side !== null && observation.side !== this.side)) {
      return this.snapshot(observation, personDetected, onBars);
    }
    this.side = observation.side;
    this.lastFrameMs = timestampMs;
    const angle = observation.angleDeg;
    const previous = this.previousAngle;
    this.previousAngle = angle;
    const previousSupported = this.previousSupported;
    this.previousSupported = observation.supportReady;
    const sustained = (holds: (value: number) => boolean) => previous !== null && holds(previous) && holds(angle);
    const atTop = angle >= T.topAngleDeg && observation.supportReady;
    const agrees = previous !== null && Math.abs(angle - previous) <= T.endpointMaxStepDeg;
    // Two consecutive supported samples near lockout, at least one past it.
    const reachedTop = agrees && previousSupported && observation.supportReady &&
      sustained((value) => value >= T.topAngleDeg - T.topNeighborMarginDeg) &&
      Math.max(previous ?? angle, angle) >= T.topAngleDeg;

    if (this.phase === "unknown") {
      if (atTop) {
        this.holdSince ??= timestampMs;
        this.holdSamples += 1;
        if (this.holdSamples >= T.minStartSamples && timestampMs - this.holdSince >= T.startHoldMs) this.enterTop(observation);
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
    } else {
      this.minimumAngle = Math.min(this.minimumAngle, angle);
      // Two consecutive samples near the bottom, at least one past it.
      const reachedBottom = agrees && sustained((value) => value <= T.bottomAngleDeg + T.bottomNeighborMarginDeg) &&
        Math.min(previous ?? angle, angle) <= T.bottomAngleDeg;
      if (reachedBottom && this.bottomMs === null) {
        this.bottomMs = timestampMs;
        this.setPhase("bottom");
      }
      if (this.phase !== "rising" && sustained((value) => value >= this.minimumAngle + T.reversalDeltaDeg)) {
        this.setPhase("rising");
        this.upwardPeak = angle;
        this.progressMs = timestampMs;
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
      if (reachedTop) this.finishRep(observation);
    }
    return this.snapshot(observation, personDetected, true);
  }

  private enterTop(observation: DipObservation) {
    this.phase = "top";
    this.phases = ["top"];
    this.startMs = observation.timestampMs;
    this.bottomMs = null;
    this.minimumAngle = 180;
    this.bars = { x: observation.wristX, y: observation.wristY, armLength: observation.armLength };
  }

  private setPhase(phase: PullUpPhase) {
    if (this.phase !== phase) this.phases.push(phase);
    this.phase = phase;
  }

  private setFault(fault: DipSnapshot["formFault"], timestampMs: number) {
    this.fault = fault;
    this.faultUntil = timestampMs + DIP_THRESHOLDS.cueHoldMs;
  }

  private finishRep(observation: DipObservation) {
    const timestampMs = observation.timestampMs;
    const valid = this.bottomMs !== null;
    if (valid) this.count += 1;
    else this.partial += 1;
    this.setPhase("top");
    this.latestRep = {
      index: ++this.repIndex, outcome: valid ? "valid" : "partial",
      startMs: this.startMs, topMs: timestampMs, endMs: timestampMs,
      phases: [...this.phases], reasonCodes: valid ? [] : ["did_not_reach_bottom"],
    };
    // "Go lower" only once a shallow rep returns to support: a turnaround
    // without depth is also how athletes step down off the bars.
    if (valid) { this.fault = null; this.faultUntil = 0; }
    else this.setFault("go-lower", timestampMs);
    // The next count needs a new confirmed descent and bottom.
    this.enterTop(observation);
  }

  private snapshot(observation: DipObservation | null, personDetected: boolean, onBars: boolean): DipSnapshot {
    const now = observation?.timestampMs ?? 0;
    return {
      ...INITIAL_SNAPSHOT, phase: this.phase, validRepCount: this.count,
      partialRepCount: this.partial, latestRep: this.latestRep, observation,
      personDetected, poseReady: observation !== null,
      setupReady: observation !== null && onBars && (observation.supportReady ||
        (this.phase !== "unknown" && this.phase !== "top")),
      startingPositionReady: this.phase !== "unknown",
      formFault: onBars && now < this.faultUntil ? this.fault : null,
    };
  }
}
