import { selectMuscleUpCue, selectPrioritizedCue, selectPushUpCue } from "./cues.ts";
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
    const observation = landmarks ? measurePullUpPose(landmarks, timestampMs) : null;
    const snapshot = this.pull.update(observation, timestampMs, landmarks !== null);
    return { snapshot, cue: selectPrioritizedCue(snapshot, timestampMs) };
  }

  getClassificationDiagnostics() { return this.pull.getClassificationDiagnostics(); }
}
