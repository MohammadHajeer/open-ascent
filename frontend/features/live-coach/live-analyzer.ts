import { selectDipCue, selectMuscleUpCue, selectPrioritizedCue, selectPushUpCue } from "./cues.ts";
import { LiveDipAnalyzer, measureDipPose } from "./dip-analyzer.ts";
import { LiveMuscleUpAnalyzer, measureMuscleUpPose } from "./muscle-up-analyzer.ts";
import { LivePushUpAnalyzer, measurePushUpPose } from "./push-up-analyzer.ts";
import { measurePullUpPose } from "./pull-up-semantics.ts";
import { INITIAL_SNAPSHOT } from "./session-state.ts";
import type { LiveCoachMovement, PoseLandmark } from "./types.ts";
import { LiveVerticalPullAnalyzer } from "./vertical-pull-analyzer.ts";

/** Select exactly one local detector; never carry a candidate across movements. */
export class LiveCoachAnalyzer {
  private pull = new LiveVerticalPullAnalyzer();
  private push = new LivePushUpAnalyzer();
  private muscle = new LiveMuscleUpAnalyzer();
  private dip = new LiveDipAnalyzer();
  movement: LiveCoachMovement = "vertical-pull";

  selectMovement(movement: LiveCoachMovement) {
    this.movement = movement;
    this.reset();
    return INITIAL_SNAPSHOT;
  }

  reset() {
    this.pull.reset();
    this.push.reset();
    this.muscle.reset();
    this.dip.reset();
  }

  update(landmarks: PoseLandmark[] | null, timestampMs: number, aspectRatio = 1) {
    if (this.movement === "push-up") {
      const observation = landmarks ? measurePushUpPose(landmarks, timestampMs, aspectRatio, this.push.selectedSide) : null;
      const snapshot = this.push.update(observation, timestampMs, landmarks !== null);
      return { snapshot, cue: selectPushUpCue(snapshot, timestampMs) };
    }
    if (this.movement === "muscle-up") {
      const observation = landmarks ? measureMuscleUpPose(landmarks, timestampMs, aspectRatio, this.muscle.selectedSide) : null;
      const snapshot = this.muscle.update(observation, timestampMs, landmarks !== null);
      return { snapshot, cue: selectMuscleUpCue(snapshot, timestampMs) };
    }
    if (this.movement === "dips") {
      const observation = landmarks ? measureDipPose(landmarks, timestampMs, aspectRatio, this.dip.selectedSide) : null;
      const snapshot = this.dip.update(observation, timestampMs, landmarks !== null);
      return { snapshot, cue: selectDipCue(snapshot, timestampMs) };
    }
    const observation = landmarks ? measurePullUpPose(landmarks, timestampMs) : null;
    const snapshot = this.pull.update(observation, timestampMs, landmarks !== null);
    return { snapshot, cue: selectPrioritizedCue(snapshot, timestampMs) };
  }

  getClassificationDiagnostics() { return this.pull.getClassificationDiagnostics(); }
}
