import { PULL_UP_SEMANTICS } from "./pull-up-semantics.ts";
import type {
  PullUpObservation,
  PullUpPhase,
  PullUpRep,
  PullUpSnapshot,
} from "./types.ts";

export class LivePullUpAnalyzer {
  private phase: PullUpPhase = "unknown";
  private validRepCount = 0;
  private partialRepCount = 0;
  private repIndex = 0;
  private latestRep: PullUpRep | null = null;
  private repStartMs: number | null = null;
  private topMs: number | null = null;
  private topEntryAngleDeg: number | null = null;
  private minimumAngleDeg: number | null = null;
  private bottomBodyRelativeY: number | null = null;
  private phaseHistory: PullUpPhase[] = [];
  private readySinceMs: number | null = null;
  private invalidSinceMs: number | null = null;
  private personDetected = false;

  reset() {
    this.phase = "unknown";
    this.validRepCount = 0;
    this.partialRepCount = 0;
    this.repIndex = 0;
    this.latestRep = null;
    this.resetCandidate();
    this.readySinceMs = null;
    this.invalidSinceMs = null;
    this.personDetected = false;
  }

  update(
    observation: PullUpObservation | null,
    timestampMs: number,
    personDetected = observation !== null,
  ): PullUpSnapshot {
    this.personDetected = personDetected;
    if (!observation) return this.handleInvalid(timestampMs);

    this.invalidSinceMs = null;
    // A 170 ms median at the 12 fps live target can erase a genuine top that
    // appears in one sampled frame. Use observed extrema and body motion.
    const angleDeg = observation.angleDeg;
    const setupReady = observation.handsAboveShoulders && observation.bodyUnderHands;

    if (this.phase === "unknown") {
      const bottomReady = setupReady && angleDeg >= PULL_UP_SEMANTICS.bottomAngleDeg;
      if (!bottomReady) {
        this.readySinceMs = null;
        return this.snapshot(observation, setupReady);
      }
      this.readySinceMs ??= timestampMs;
      if (timestampMs - this.readySinceMs >= PULL_UP_SEMANTICS.hangConfirmationMs) {
        this.startCandidate(timestampMs, observation.bodyRelativeY);
      }
      return this.snapshot(observation, setupReady);
    }

    if (!setupReady) return this.handleInvalid(timestampMs, observation);

    if (this.phase === "bottom") {
      if (angleDeg >= PULL_UP_SEMANTICS.bottomAngleDeg) {
        this.refreshBottom(timestampMs, observation.bodyRelativeY);
        return this.snapshot(observation, true);
      }
      const leftBottom = angleDeg <=
        PULL_UP_SEMANTICS.bottomAngleDeg - PULL_UP_SEMANTICS.motionAngleDeltaDeg;
      const bodyRise = this.bottomBodyRelativeY !== null &&
        this.bottomBodyRelativeY - observation.bodyRelativeY >=
          PULL_UP_SEMANTICS.repStartBodyRiseThreshold;
      if (leftBottom && bodyRise) {
        this.setPhase("rising");
        this.minimumAngleDeg = angleDeg;
        // A low-FPS stream may sample bottom and top without an intermediate
        // rising frame. Require meaningful shoulder travel for that shortcut.
        if (this.isTop(angleDeg, observation) && this.hasStrongBodyRise(observation)) {
          this.enterTop(timestampMs, angleDeg);
        }
      }
      return this.snapshot(observation, true);
    }

    if (this.phase === "rising") {
      this.minimumAngleDeg = Math.min(this.minimumAngleDeg ?? angleDeg, angleDeg);
      if (this.isTop(angleDeg, observation)) {
        this.enterTop(timestampMs, angleDeg);
        return this.snapshot(observation, true);
      }
      if (
        angleDeg >= PULL_UP_SEMANTICS.bottomAngleDeg &&
        this.returnedToStart(observation)
      ) {
        if (this.minimumAngleDeg <= PULL_UP_SEMANTICS.partialTopAngleDeg) {
          this.setPhase("bottom");
          this.finishRep("partial", timestampMs, observation.bodyRelativeY, ["did_not_reach_top"]);
        } else {
          this.startCandidate(timestampMs, observation.bodyRelativeY);
        }
      }
      return this.snapshot(observation, true);
    }

    if (this.phase === "top") {
      if (
        angleDeg >= PULL_UP_SEMANTICS.bottomAngleDeg &&
        this.returnedToStart(observation)
      ) {
        this.setPhase("lowering");
        this.setPhase("bottom");
        this.finishRep("valid", timestampMs, observation.bodyRelativeY);
      } else if (
        this.topEntryAngleDeg !== null &&
        angleDeg >= this.topEntryAngleDeg + PULL_UP_SEMANTICS.motionAngleDeltaDeg
      ) {
        this.setPhase("lowering");
      }
      return this.snapshot(observation, true);
    }

    if (
      angleDeg >= PULL_UP_SEMANTICS.bottomAngleDeg &&
      this.returnedToStart(observation)
    ) {
      this.setPhase("bottom");
      this.finishRep("valid", timestampMs, observation.bodyRelativeY);
    }
    return this.snapshot(observation, true);
  }

  getSnapshot(): PullUpSnapshot {
    return this.snapshot(null, false);
  }

  private handleInvalid(timestampMs: number, observation: PullUpObservation | null = null) {
    this.readySinceMs = null;
    this.invalidSinceMs ??= timestampMs;
    if (timestampMs - this.invalidSinceMs > PULL_UP_SEMANTICS.invalidPositionToleranceMs) {
      if (
        this.phase === "rising" &&
        this.minimumAngleDeg !== null &&
        this.minimumAngleDeg <= PULL_UP_SEMANTICS.partialTopAngleDeg
      ) {
        this.finishRep("uncertain", timestampMs, this.bottomBodyRelativeY ?? 0, ["tracking_lost"]);
      }
      this.phase = "unknown";
      this.resetCandidate();
    }
    return this.snapshot(observation, false);
  }

  private isTop(angleDeg: number, observation: PullUpObservation) {
    if (angleDeg <= PULL_UP_SEMANTICS.topAngleDeg) return true;
    if (
      observation.faceToWristY === null ||
      observation.faceToWristY > PULL_UP_SEMANTICS.faceToWristTopTolerance ||
      angleDeg > PULL_UP_SEMANTICS.faceAssistedTopMaxAngleDeg ||
      this.bottomBodyRelativeY === null
    ) return false;

    const bottomDistance = Math.abs(this.bottomBodyRelativeY);
    if (bottomDistance <= 1e-6) return false;
    const bodyRiseRatio =
      (this.bottomBodyRelativeY - observation.bodyRelativeY) / bottomDistance;
    return bodyRiseRatio >= PULL_UP_SEMANTICS.faceAssistedTopMinBodyRiseRatio;
  }

  private enterTop(timestampMs: number, angleDeg: number) {
    this.setPhase("top");
    this.topMs = timestampMs;
    this.topEntryAngleDeg = angleDeg;
  }

  private returnedToStart(observation: PullUpObservation) {
    return this.bottomBodyRelativeY !== null && observation.bodyRelativeY >=
      this.bottomBodyRelativeY - PULL_UP_SEMANTICS.repReturnBodyTolerance;
  }

  private hasStrongBodyRise(observation: PullUpObservation) {
    if (this.bottomBodyRelativeY === null) return false;
    const baseline = Math.abs(this.bottomBodyRelativeY);
    return baseline > 1e-6 &&
      (this.bottomBodyRelativeY - observation.bodyRelativeY) / baseline >=
        PULL_UP_SEMANTICS.faceAssistedTopMinBodyRiseRatio;
  }

  private setPhase(phase: PullUpPhase) {
    if (phase === this.phase) return;
    this.phase = phase;
    this.phaseHistory.push(phase);
  }

  private startCandidate(timestampMs: number, bodyRelativeY: number) {
    this.phase = "bottom";
    this.repStartMs = timestampMs;
    this.topMs = null;
    this.topEntryAngleDeg = null;
    this.minimumAngleDeg = null;
    this.bottomBodyRelativeY = bodyRelativeY;
    this.phaseHistory = ["bottom"];
  }

  private refreshBottom(timestampMs: number, bodyRelativeY: number) {
    this.repStartMs = timestampMs;
    this.bottomBodyRelativeY = bodyRelativeY;
    this.topMs = null;
    this.topEntryAngleDeg = null;
    this.minimumAngleDeg = null;
    this.phaseHistory = ["bottom"];
  }

  private finishRep(
    outcome: PullUpRep["outcome"],
    endMs: number,
    bottomBodyRelativeY: number,
    reasonCodes: string[] = [],
  ) {
    if (this.repStartMs === null) return;
    if (outcome === "valid") this.validRepCount += 1;
    if (outcome === "partial") this.partialRepCount += 1;
    this.repIndex += 1;
    this.latestRep = {
      index: this.repIndex,
      outcome,
      startMs: this.repStartMs,
      topMs: this.topMs,
      endMs,
      phases: [...this.phaseHistory],
      reasonCodes,
    };
    this.startCandidate(endMs, bottomBodyRelativeY);
  }

  private resetCandidate() {
    this.repStartMs = null;
    this.topMs = null;
    this.topEntryAngleDeg = null;
    this.minimumAngleDeg = null;
    this.bottomBodyRelativeY = null;
    this.phaseHistory = [];
  }

  private snapshot(observation: PullUpObservation | null, setupReady: boolean): PullUpSnapshot {
    return {
      phase: this.phase,
      validRepCount: this.validRepCount,
      partialRepCount: this.partialRepCount,
      personDetected: this.personDetected,
      poseReady: observation !== null,
      setupReady,
      startingPositionReady: observation !== null && this.phase !== "unknown",
      latestRep: this.latestRep,
      observation,
    };
  }
}
