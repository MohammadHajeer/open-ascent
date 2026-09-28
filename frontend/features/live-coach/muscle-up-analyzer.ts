import { calculateAngle, POSE_INDEX, PULL_UP_SEMANTICS } from "./pull-up-semantics.ts";
import { INITIAL_SNAPSHOT } from "./session-state.ts";
import type { MuscleUpObservation, MuscleUpPhase, MuscleUpRep, MuscleUpSnapshot, PoseLandmark } from "./types.ts";

export const MUSCLE_UP_THRESHOLDS = {
  // Same "extended arm" as the Pull-Up hang (145°). It confirms hang and
  // support only; shoulder height decides which of the two the athlete is in.
  extendedElbowDeg: 145,
  // Hang: shoulder at least half an arm length below the wrist.
  hangMaxShoulderAboveWrist: -0.5,
  // Transition: shoulder at or above wrist (bar) height.
  transitionMinShoulderAboveWrist: 0,
  // Support: shoulder at least half an arm length above the wrist. A
  // chest-to-bar pull-up peaks around +0.3, and with bent elbows.
  supportMinShoulderAboveWrist: 0.5,
  // A pull that bends the elbow this far (the Pull-Up partial top, 90°) or
  // reaches wrist height is a real attempt: returning without support is a partial.
  strongPullElbowDeg: 90,
  // Hands stay on the bar through a rep. A wrist farther than this from its
  // hang height means the hands left the bar (standing with arms down looks
  // exactly like support), so that frame is not used.
  barToleranceArmLengths: 0.5,
  // Initial arming hold, as the Pull-Up hang confirmation.
  hangHoldMs: 350,
  maxFrameGapMs: 600,
  cueHoldMs: 2500,
} as const;

const SIDES = {
  left: [POSE_INDEX.leftShoulder, POSE_INDEX.leftElbow, POSE_INDEX.leftWrist],
  right: [POSE_INDEX.rightShoulder, POSE_INDEX.rightElbow, POSE_INDEX.rightWrist],
} as const;

// Side-view measurement of one arm. Normalized x/y have different scales on a
// non-square video, so x is corrected first; preview mirroring never matters.
export function measureMuscleUpPose(
  landmarks: readonly PoseLandmark[], timestampMs: number,
  aspectRatio = 1, preferredSide: MuscleUpObservation["side"] | null = null,
): MuscleUpObservation | null {
  if (!Number.isFinite(aspectRatio) || aspectRatio <= 0) return null;
  const candidates = (["left", "right"] as const).flatMap((side) => {
    const points = SIDES[side].map((index) => landmarks[index]);
    if (points.some((point) => !point || !Number.isFinite(point.x) || !Number.isFinite(point.y))) return [];
    const minimumVisibility = Math.min(...points.map((point) => Math.min(point.visibility ?? 1, point.presence ?? 1)));
    if (!Number.isFinite(minimumVisibility) || minimumVisibility < PULL_UP_SEMANTICS.minLandmarkVisibility) return [];
    const [shoulder, elbow, wrist] = points.map((point) => ({ ...point, x: point.x * aspectRatio }));
    const elbowAngleDeg = calculateAngle(shoulder, elbow, wrist);
    if (elbowAngleDeg === null) return [];
    const armLength = Math.hypot(shoulder.x - elbow.x, shoulder.y - elbow.y) +
      Math.hypot(elbow.x - wrist.x, elbow.y - wrist.y);
    return [{
      timestampMs, elbowAngleDeg, shoulderAboveWrist: (wrist.y - shoulder.y) / armLength,
      wristY: wrist.y, armLength, minimumVisibility, side,
    }];
  });
  // Keep the initially stronger side while reliable, avoiding value jumps.
  return candidates.find((item) => item.side === preferredSide) ??
    candidates.sort((a, b) => b.minimumVisibility - a.minimumVisibility)[0] ?? null;
}

type Zones = { hang: boolean; aboveWrist: boolean; support: boolean; strongPull: boolean };

/**
 * HANG → PULLING → TRANSITION → SUPPORT → RETURN → HANG (count once).
 * Every transition needs two consecutive agreeing samples; a count needs a
 * confirmed support and then a confirmed straight-arm hang.
 */
export class LiveMuscleUpAnalyzer {
  private phase: MuscleUpPhase = "unknown";
  private count = 0;
  private partial = 0;
  private repIndex = 0;
  private latestRep: MuscleUpRep | null = null;
  private side: MuscleUpObservation["side"] | null = null;
  private lastFrameMs: number | null = null;
  private previous: Zones | null = null;
  private hangSince: number | null = null;
  private hangSamples = 0;
  private barY: number | null = null;
  private startMs = 0;
  private topMs: number | null = null;
  private strongPull = false;
  private phases: MuscleUpPhase[] = [];
  private fault: MuscleUpSnapshot["formFault"] = null;
  private faultUntil = 0;

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
    this.previous = null;
    this.hangSince = null;
    this.hangSamples = 0;
    this.barY = null;
    this.topMs = null;
    this.strongPull = false;
    this.phases = [];
    this.fault = null;
    this.faultUntil = 0;
  }

  update(observation: MuscleUpObservation | null, timestampMs: number, personDetected = observation !== null): MuscleUpSnapshot {
    const T = MUSCLE_UP_THRESHOLDS;
    const onBar = observation !== null && (this.barY === null ||
      Math.abs(observation.wristY - this.barY) <= T.barToleranceArmLengths * observation.armLength);
    // Skip a brief unusable frame; samples either side still count as
    // consecutive. A blind interval longer than maxFrameGapMs cannot complete
    // a rep: discard only the in-flight candidate, preserve totals, re-arm at a hang.
    if (!observation || !onBar) {
      if (this.lastFrameMs === null || timestampMs - this.lastFrameMs > T.maxFrameGapMs) {
        this.clearCycle();
        this.lastFrameMs = null;
      }
      return this.snapshot(observation, personDetected, false);
    }
    if ((this.lastFrameMs !== null && timestampMs - this.lastFrameMs > T.maxFrameGapMs) ||
      (this.side !== null && observation.side !== this.side)) this.clearCycle();
    this.side = observation.side;
    this.lastFrameMs = timestampMs;

    const extended = observation.elbowAngleDeg >= T.extendedElbowDeg;
    const zones: Zones = {
      hang: extended && observation.shoulderAboveWrist <= T.hangMaxShoulderAboveWrist,
      aboveWrist: observation.shoulderAboveWrist >= T.transitionMinShoulderAboveWrist,
      support: extended && observation.shoulderAboveWrist >= T.supportMinShoulderAboveWrist,
      strongPull: observation.elbowAngleDeg <= T.strongPullElbowDeg ||
        observation.shoulderAboveWrist >= T.transitionMinShoulderAboveWrist,
    };
    const previous = this.previous;
    this.previous = zones;
    const sustained = (key: keyof Zones, value = true) =>
      previous !== null && previous[key] === value && zones[key] === value;

    if (this.phase === "unknown") {
      if (zones.hang) {
        this.hangSince ??= timestampMs;
        this.hangSamples += 1;
        if (this.hangSamples >= 2 && timestampMs - this.hangSince >= T.hangHoldMs) {
          this.enterHang(timestampMs, observation.wristY);
        }
      } else {
        this.hangSince = null;
        this.hangSamples = 0;
      }
      return this.snapshot(observation, personDetected, true);
    }

    if (this.phase === "bottom") {
      if (zones.hang) this.barY = observation.wristY;
      else if (sustained("hang", false)) {
        this.setPhase("rising");
        this.startMs = timestampMs;
      }
    }
    if (this.phase === "rising" || this.phase === "transition") {
      if (sustained("strongPull")) this.strongPull = true;
      if (sustained("support")) {
        this.setPhase("top");
        this.topMs = timestampMs;
      } else if (this.phase === "rising" && sustained("aboveWrist")) {
        this.setPhase("transition");
      } else if (sustained("hang")) {
        // Back to the hang without support: a strong pull is a failed attempt;
        // a kip swing or small pull simply re-arms.
        if (this.strongPull) this.finishRep("partial", timestampMs, observation.wristY);
        else this.enterHang(timestampMs, observation.wristY);
      }
    }
    // Staying in support never counts; only the return to a hang does.
    if (this.phase === "top" && sustained("support", false)) this.setPhase("lowering");
    if (this.phase === "lowering") {
      if (sustained("support")) this.setPhase("top");
      else if (sustained("hang")) this.finishRep("valid", timestampMs, observation.wristY);
    }
    return this.snapshot(observation, personDetected, true);
  }

  private enterHang(timestampMs: number, wristY: number) {
    this.phase = "bottom";
    this.phases = ["bottom"];
    this.startMs = timestampMs;
    this.topMs = null;
    this.strongPull = false;
    this.barY = wristY;
  }

  private setPhase(phase: MuscleUpPhase) {
    if (this.phase !== phase) this.phases.push(phase);
    this.phase = phase;
  }

  private finishRep(outcome: "valid" | "partial", timestampMs: number, wristY: number) {
    this.setPhase("bottom");
    if (outcome === "valid") {
      this.count += 1;
      this.fault = null;
      this.faultUntil = 0;
    } else {
      this.partial += 1;
      this.fault = "get-over-bar";
      this.faultUntil = timestampMs + MUSCLE_UP_THRESHOLDS.cueHoldMs;
    }
    this.latestRep = {
      index: ++this.repIndex, outcome, startMs: this.startMs, topMs: this.topMs, endMs: timestampMs,
      phases: [...this.phases], reasonCodes: outcome === "valid" ? [] : ["did_not_reach_support"],
    };
    this.enterHang(timestampMs, wristY);
  }

  private snapshot(observation: MuscleUpObservation | null, personDetected: boolean, usable: boolean): MuscleUpSnapshot {
    const armed = this.phase !== "unknown";
    const now = observation?.timestampMs ?? 0;
    return {
      ...INITIAL_SNAPSHOT, phase: this.phase, validRepCount: this.count,
      partialRepCount: this.partial, latestRep: this.latestRep, observation,
      personDetected, poseReady: observation !== null,
      setupReady: usable && (armed ||
        (observation?.shoulderAboveWrist ?? 0) <= MUSCLE_UP_THRESHOLDS.hangMaxShoulderAboveWrist),
      startingPositionReady: armed,
      formFault: usable && now < this.faultUntil ? this.fault : null,
    };
  }
}
