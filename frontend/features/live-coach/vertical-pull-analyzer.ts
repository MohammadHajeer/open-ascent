import { PULL_UP_SEMANTICS } from "./pull-up-semantics.ts";
import { emptyVariantBreakdown, VARIANT_EVIDENCE, type VerticalPullVariant } from "./vertical-pull-config.ts";
import type {
  PullUpObservation,
  PullUpPhase,
  PullUpRep,
  PullUpSnapshot,
} from "./types.ts";

type Grip = NonNullable<PullUpObservation["grip"]>;
type Width = NonNullable<PullUpObservation["width"]>;
type Evidence = { grip: Grip; width: Width };

function stableVote<T extends string>(values: T[], unknown: T): T {
  const usable = values.filter((value) => value !== unknown);
  if (usable.length < 3 || usable.length / values.length < 0.6) return unknown;
  const counts = new Map<T, number>();
  for (const value of usable) counts.set(value, (counts.get(value) ?? 0) + 1);
  const [winner, count] = [...counts].sort((left, right) => right[1] - left[1])[0];
  return count / usable.length >= 0.7 && count / values.length >= 0.6 ? winner : unknown;
}

export function classifyCompletedVerticalPullRep(
  evidence: readonly Evidence[],
  topRatios: readonly number[],
): NonNullable<PullUpRep["classification"]> {
  const grip = stableVote(evidence.map((item) => item.grip), "unknown" as Grip);
  const width = stableVote(evidence.map((item) => item.width), "unknown" as Width);
  // A single very strong sample preserves Phase 1 fast-rep support. Borderline
  // high evidence needs two top frames. The gap remains unknown.
  const height = topRatios.some((ratio) => ratio <= 0.05) ||
    topRatios.filter((ratio) => ratio <= VARIANT_EVIDENCE.highUpperTorsoToWristRatioMax).length >= 2
    ? "high" : topRatios.some((ratio) => ratio >= 0.25) ? "standard" : "unknown";
  let variant: VerticalPullVariant = "unknown";
  if (grip !== "unknown" && width !== "unknown" && height !== "unknown") {
    if (grip === "supinated" && width === "standard") variant = "chin-up";
    else if (grip === "pronated" && width === "close") variant = "close-grip-pull-up";
    else if (grip === "pronated" && width === "wide") variant = "wide-grip-pull-up";
    else if (grip === "pronated" && width === "standard") {
      variant = height === "high" ? "high-pull-up" : "pull-up";
    }
  }
  return { grip, width, height, variant };
}

export class LiveVerticalPullAnalyzer {
  private variantBreakdown = emptyVariantBreakdown();
  private bottomEvidence: Evidence[] = [];
  private repEvidence: Evidence[] = [];
  private topRatios: number[] = [];
  private extensionSamples = 0;
  private extensionSinceMs: number | null = null;
  private kneeSamples = 0;
  private kneeSinceMs: number | null = null;
  private lowerPath: { at: number; hip: number; ankle: number }[] = [];
  private formFault: PullUpSnapshot["formFault"] = null;
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
    this.variantBreakdown = emptyVariantBreakdown();
    this.bottomEvidence = [];
    this.repEvidence = [];
    this.topRatios = [];
    this.extensionSamples = 0;
    this.extensionSinceMs = null;
    this.kneeSamples = 0;
    this.kneeSinceMs = null;
    this.lowerPath = [];
    this.formFault = null;
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
    const evidence = { grip: observation.grip ?? "unknown" as Grip,
      width: observation.width ?? "unknown" as Width };
    if ((this.phase === "unknown" || this.phase === "bottom") &&
      setupReady && angleDeg >= PULL_UP_SEMANTICS.bottomAngleDeg) {
      this.bottomEvidence.push(evidence);
      this.bottomEvidence = this.bottomEvidence.slice(-8);
      if (this.phase === "bottom") this.repEvidence = [...this.bottomEvidence];
    } else if (this.phase !== "unknown") {
      this.repEvidence.push(evidence);
    }
    this.observeForm(observation, timestampMs, setupReady);

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

    // A high pull can bring the upper torso above the wrist line. The
    // confirmed bottom still requires hands overhead, but motion need not.
    if (!(observation.motionReady ?? setupReady)) return this.handleInvalid(timestampMs, observation);

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
          this.enterTop(timestampMs, angleDeg, observation);
        }
      }
      return this.snapshot(observation, true);
    }

    if (this.phase === "rising") {
      this.minimumAngleDeg = Math.min(this.minimumAngleDeg ?? angleDeg, angleDeg);
      if (this.isTop(angleDeg, observation)) {
        this.enterTop(timestampMs, angleDeg, observation);
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
      this.observeTopHeight(observation);
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

  private enterTop(timestampMs: number, angleDeg: number, observation: PullUpObservation) {
    this.setPhase("top");
    this.topMs = timestampMs;
    this.topEntryAngleDeg = angleDeg;
    this.observeTopHeight(observation);
  }

  private observeTopHeight(observation: PullUpObservation) {
    if (observation.angleDeg <= PULL_UP_SEMANTICS.partialTopAngleDeg &&
      observation.upperTorsoToWristRatio != null &&
      Number.isFinite(observation.upperTorsoToWristRatio)) {
      this.topRatios.push(observation.upperTorsoToWristRatio);
    }
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
    this.lowerPath = [];
    this.repEvidence = [...this.bottomEvidence];
    this.topRatios = [];
  }

  private refreshBottom(timestampMs: number, bodyRelativeY: number) {
    this.repStartMs = timestampMs;
    this.bottomBodyRelativeY = bodyRelativeY;
    this.topMs = null;
    this.topEntryAngleDeg = null;
    this.minimumAngleDeg = null;
    this.phaseHistory = ["bottom"];
    this.repEvidence = [...this.bottomEvidence];
    this.topRatios = [];
  }

  private finishRep(
    outcome: PullUpRep["outcome"],
    endMs: number,
    bottomBodyRelativeY: number,
    reasonCodes: string[] = [],
  ) {
    if (this.repStartMs === null) return;
    const classification = outcome === "valid"
      ? classifyCompletedVerticalPullRep(this.repEvidence, this.topRatios) : undefined;
    if (outcome === "valid") this.validRepCount += 1;
    if (classification) this.variantBreakdown[classification.variant] += 1;
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
      classification,
    };
    const nextBottomEvidence = this.bottomEvidence.slice(-1);
    this.bottomEvidence = nextBottomEvidence;
    this.startCandidate(endMs, bottomBodyRelativeY);
  }

  private resetCandidate() {
    this.repStartMs = null;
    this.topMs = null;
    this.topEntryAngleDeg = null;
    this.minimumAngleDeg = null;
    this.bottomBodyRelativeY = null;
    this.phaseHistory = [];
    this.repEvidence = [];
    this.topRatios = [];
    this.bottomEvidence = [];
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
      variantBreakdown: { ...this.variantBreakdown },
      observation,
      formFault: observation ? this.formFault : null,
    };
  }

  private observeForm(observation: PullUpObservation, timestampMs: number, setupReady: boolean) {
    const extensionIssue = this.phase === "unknown" && setupReady && observation.angleDeg < 140;
    if (extensionIssue) {
      this.extensionSinceMs ??= timestampMs;
      this.extensionSamples += 1;
    } else {
      this.extensionSinceMs = null;
      this.extensionSamples = 0;
    }
    const kneeIssue = this.phase !== "unknown" && observation.kneeAngleDeg !== undefined &&
      observation.kneeAngleDeg !== null && observation.kneeAngleDeg <= 145;
    if (kneeIssue) {
      this.kneeSinceMs ??= timestampMs;
      this.kneeSamples += 1;
    } else {
      this.kneeSinceMs = null;
      this.kneeSamples = 0;
    }
    if (this.phase !== "unknown" && observation.hipHorizontalRatio != null &&
      observation.ankleHorizontalRatio != null) {
      this.lowerPath.push({ at: timestampMs, hip: observation.hipHorizontalRatio,
        ankle: observation.ankleHorizontalRatio });
      this.lowerPath = this.lowerPath.filter((item) => timestampMs - item.at <= 1200);
    }
    const stableExtension = this.extensionSamples >= 3 && this.extensionSinceMs !== null &&
      timestampMs - this.extensionSinceMs >= 160;
    const stableKnee = this.kneeSamples >= 3 && this.kneeSinceMs !== null &&
      timestampMs - this.kneeSinceMs >= 160;
    this.formFault = stableExtension ? "extend-at-bottom" :
      stableKnee ? "excessive-knee-bend" : this.hasBodySwing() ? "body-swing" : null;
  }

  private hasBodySwing() {
    if (this.lowerPath.length < 5) return false;
    return (["hip", "ankle"] as const).some((key) => {
      const raw = this.lowerPath.map((item) => item[key]);
      const values = raw.map((_, index) => {
        const neighbors = raw.slice(Math.max(0, index - 1), Math.min(raw.length, index + 2))
          .sort((left, right) => left - right);
        const mid = Math.floor(neighbors.length / 2);
        return neighbors.length % 2 ? neighbors[mid] : (neighbors[mid - 1] + neighbors[mid]) / 2;
      });
      const range = Math.max(...values) - Math.min(...values);
      if (range < 0.30) return false;
      const directions = values.slice(1).map((value, index) => value - values[index])
        .filter((delta) => Math.abs(delta) >= 0.05).map(Math.sign);
      return directions.some((direction, index) => index > 0 && direction !== directions[index - 1]);
    });
  }
}

// Keep the Phase 1 API and its regression fixtures intact.
export class LivePullUpAnalyzer extends LiveVerticalPullAnalyzer {}
