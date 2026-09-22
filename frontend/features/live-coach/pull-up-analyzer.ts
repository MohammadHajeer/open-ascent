import { PULL_UP_SEMANTICS } from "./pull-up-semantics.ts";
import type {
  PullUpObservation,
  PullUpPhase,
  PullUpRep,
  PullUpSnapshot,
} from "./types.ts";

type PendingTransition = { phase: PullUpPhase; frames: number } | null;

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
  private angleWindow: { timestampMs: number; angleDeg: number }[] = [];
  private readySinceMs: number | null = null;
  private invalidSinceMs: number | null = null;
  private pendingTransition: PendingTransition = null;

  reset() {
    this.phase = "unknown";
    this.validRepCount = 0;
    this.partialRepCount = 0;
    this.repIndex = 0;
    this.latestRep = null;
    this.resetCandidate();
    this.angleWindow = [];
    this.readySinceMs = null;
    this.invalidSinceMs = null;
  }

  update(observation: PullUpObservation | null, timestampMs: number) {
    if (!observation) return this.handleInvalid(timestampMs);

    this.invalidSinceMs = null;
    this.angleWindow.push({ timestampMs, angleDeg: observation.angleDeg });
    this.angleWindow = this.angleWindow.filter(
      (sample) =>
        timestampMs - sample.timestampMs <= PULL_UP_SEMANTICS.angleSmoothingMs,
    );
    const angleDeg = median(this.angleWindow.map((sample) => sample.angleDeg));
    const setupReady = observation.handsAboveShoulders && observation.bodyUnderHands;

    if (this.phase === "unknown") {
      const bottomReady =
        setupReady && angleDeg >= PULL_UP_SEMANTICS.bottomAngleDeg;
      if (!bottomReady) {
        this.readySinceMs = null;
        return this.snapshot(observation, false);
      }

      this.readySinceMs ??= timestampMs;
      if (
        timestampMs - this.readySinceMs >=
        PULL_UP_SEMANTICS.hangConfirmationMs
      ) {
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

      const leftBottom =
        angleDeg <=
        PULL_UP_SEMANTICS.bottomAngleDeg -
          PULL_UP_SEMANTICS.motionAngleDeltaDeg;
      const bodyRise =
        this.bottomBodyRelativeY === null ||
        this.bottomBodyRelativeY - observation.bodyRelativeY >=
          PULL_UP_SEMANTICS.repStartBodyRiseThreshold;

      if (leftBottom && bodyRise && this.confirm("rising")) {
        this.setPhase("rising");
        this.minimumAngleDeg = angleDeg;
      } else if (!leftBottom || !bodyRise) {
        this.pendingTransition = null;
      }
      return this.snapshot(observation, true);
    }

    if (this.phase === "rising") {
      this.minimumAngleDeg = Math.min(
        this.minimumAngleDeg ?? angleDeg,
        angleDeg,
      );

      const topConfirmed = this.isTop(angleDeg, observation);
      if (topConfirmed && this.confirm("top")) {
        this.setPhase("top");
        this.topMs = timestampMs;
        this.topEntryAngleDeg = angleDeg;
        return this.snapshot(observation, true);
      }

      const returnedToBottom = angleDeg >= PULL_UP_SEMANTICS.bottomAngleDeg;
      if (returnedToBottom && this.confirm("bottom")) {
        if (
          this.minimumAngleDeg !== null &&
          this.minimumAngleDeg <= PULL_UP_SEMANTICS.partialTopAngleDeg
        ) {
          this.setPhase("bottom");
          this.finishRep(
            "partial",
            timestampMs,
            observation.bodyRelativeY,
            ["did_not_reach_top"],
          );
        } else {
          this.startCandidate(timestampMs, observation.bodyRelativeY);
        }
      } else if (!topConfirmed && !returnedToBottom) this.pendingTransition = null;
      return this.snapshot(observation, true);
    }

    if (this.phase === "top") {
      const returnedToBottom = angleDeg >= PULL_UP_SEMANTICS.bottomAngleDeg;
      const loweringStarted =
        this.topEntryAngleDeg !== null &&
        angleDeg >=
          this.topEntryAngleDeg + PULL_UP_SEMANTICS.motionAngleDeltaDeg;
      if (returnedToBottom) {
        if (this.confirm("bottom")) {
          this.setPhase("lowering");
          this.setPhase("bottom");
          this.finishRep("valid", timestampMs, observation.bodyRelativeY);
        }
      } else if (loweringStarted) {
        if (this.confirm("lowering")) this.setPhase("lowering");
      } else {
        this.pendingTransition = null;
      }
      return this.snapshot(observation, true);
    }

    if (this.phase === "lowering") {
      if (angleDeg >= PULL_UP_SEMANTICS.bottomAngleDeg) {
        if (this.confirm("bottom")) {
          this.setPhase("bottom");
          this.finishRep("valid", timestampMs, observation.bodyRelativeY);
        }
      } else {
        this.pendingTransition = null;
      }
    }

    return this.snapshot(observation, true);
  }

  getSnapshot(): PullUpSnapshot {
    return this.snapshot(null, false);
  }

  private handleInvalid(
    timestampMs: number,
    observation: PullUpObservation | null = null,
  ) {
    this.pendingTransition = null;
    this.readySinceMs = null;
    this.invalidSinceMs ??= timestampMs;

    if (
      timestampMs - this.invalidSinceMs >
      PULL_UP_SEMANTICS.invalidPositionToleranceMs
    ) {
      if (
        this.phase === "rising" &&
        this.minimumAngleDeg !== null &&
        this.minimumAngleDeg <= PULL_UP_SEMANTICS.partialTopAngleDeg
      ) {
        this.finishRep(
          "uncertain",
          timestampMs,
          this.bottomBodyRelativeY ?? 0,
          ["tracking_lost"],
        );
      }
      this.phase = "unknown";
      this.resetCandidate();
      this.angleWindow = [];
    }

    return this.snapshot(observation, false);
  }

  private isTop(angleDeg: number, observation: PullUpObservation) {
    if (angleDeg <= PULL_UP_SEMANTICS.topAngleDeg) return true;
    if (
      observation.faceToWristY === null ||
      observation.faceToWristY >
        PULL_UP_SEMANTICS.faceToWristTopTolerance ||
      angleDeg > PULL_UP_SEMANTICS.faceAssistedTopMaxAngleDeg ||
      this.bottomBodyRelativeY === null
    ) {
      return false;
    }

    const bottomDistance = Math.abs(this.bottomBodyRelativeY);
    if (bottomDistance <= 1e-6) return false;
    const bodyRiseRatio =
      (this.bottomBodyRelativeY - observation.bodyRelativeY) / bottomDistance;
    return (
      bodyRiseRatio >=
      PULL_UP_SEMANTICS.faceAssistedTopMinBodyRiseRatio
    );
  }

  private confirm(phase: PullUpPhase) {
    if (this.pendingTransition?.phase === phase) {
      this.pendingTransition.frames += 1;
    } else {
      this.pendingTransition = { phase, frames: 1 };
    }
    return (
      this.pendingTransition.frames >= PULL_UP_SEMANTICS.liveTransitionFrames
    );
  }

  private setPhase(phase: PullUpPhase) {
    if (phase === this.phase) return;
    this.phase = phase;
    this.phaseHistory.push(phase);
    this.pendingTransition = null;
  }

  private startCandidate(timestampMs: number, bodyRelativeY: number) {
    this.phase = "bottom";
    this.repStartMs = timestampMs;
    this.topMs = null;
    this.topEntryAngleDeg = null;
    this.minimumAngleDeg = null;
    this.bottomBodyRelativeY = bodyRelativeY;
    this.phaseHistory = ["bottom"];
    this.pendingTransition = null;
  }

  private refreshBottom(timestampMs: number, bodyRelativeY: number) {
    this.repStartMs = timestampMs;
    this.bottomBodyRelativeY = bodyRelativeY;
    this.topMs = null;
    this.topEntryAngleDeg = null;
    this.minimumAngleDeg = null;
    this.phaseHistory = ["bottom"];
    this.pendingTransition = null;
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
    this.pendingTransition = null;
  }

  private snapshot(
    observation: PullUpObservation | null,
    setupReady: boolean,
  ): PullUpSnapshot {
    return {
      phase: this.phase,
      validRepCount: this.validRepCount,
      partialRepCount: this.partialRepCount,
      poseReady: observation !== null,
      setupReady,
      latestRep: this.latestRep,
      observation,
    };
  }
}

function median(values: number[]) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}
