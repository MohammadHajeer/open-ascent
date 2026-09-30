import { CAMERA_ROTATED_CUE, CameraLevelMonitor } from "./camera-level.ts";
import { selectDipCue, selectMuscleUpCue, selectPrioritizedCue, selectPushUpCue } from "./cues.ts";
import { LiveDipAnalyzer, measureDipPose } from "./dip-analyzer.ts";
import { LiveMuscleUpAnalyzer, measureMuscleUpPose } from "./muscle-up-analyzer.ts";
import { LivePushUpAnalyzer, measurePushUpPose } from "./push-up-analyzer.ts";
import { measurePullUpPose } from "./pull-up-semantics.ts";
import { INITIAL_SNAPSHOT } from "./session-state.ts";
import type { LiveCoachCue, LiveCoachMovement, LiveCoachSnapshot, PoseLandmark } from "./types.ts";
import { LiveVerticalPullAnalyzer } from "./vertical-pull-analyzer.ts";

/** Select exactly one local detector; never carry a candidate across movements. */
export class LiveCoachAnalyzer {
  private pull = new LiveVerticalPullAnalyzer();
  private push = new LivePushUpAnalyzer();
  private muscle = new LiveMuscleUpAnalyzer();
  private dip = new LiveDipAnalyzer();
  private level = new CameraLevelMonitor();
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
    this.level.reset();
  }

  /**
   * `aspectRatio` is the video's width / height. Omitted, landmarks are taken
   * to be in each analyzer's own calibration frame (square for the side-view
   * analyzers, 16:9 for Pull-Up).
   */
  update(landmarks: PoseLandmark[] | null, timestampMs: number, aspectRatio?: number) {
    if (this.movement === "push-up") {
      const observation = landmarks ? measurePushUpPose(landmarks, timestampMs, aspectRatio, this.push.selectedSide) : null;
      const snapshot = this.push.update(observation, timestampMs, landmarks !== null);
      return { snapshot, cue: selectPushUpCue(snapshot, timestampMs) };
    }
    // Upright movements can tell a sideways picture from the athlete's pose.
    const rotated = this.level.update(landmarks, timestampMs, aspectRatio ?? 1);
    if (this.movement === "muscle-up") {
      const observation = landmarks ? measureMuscleUpPose(landmarks, timestampMs, aspectRatio, this.muscle.selectedSide) : null;
      const snapshot = this.muscle.update(observation, timestampMs, landmarks !== null);
      return levelled(snapshot, selectMuscleUpCue(snapshot, timestampMs), rotated);
    }
    if (this.movement === "dips") {
      const observation = landmarks ? measureDipPose(landmarks, timestampMs, aspectRatio, this.dip.selectedSide) : null;
      const snapshot = this.dip.update(observation, timestampMs, landmarks !== null);
      return levelled(snapshot, selectDipCue(snapshot, timestampMs), rotated);
    }
    const observation = landmarks ? measurePullUpPose(landmarks, timestampMs, aspectRatio) : null;
    const snapshot = this.pull.update(observation, timestampMs, landmarks !== null);
    return levelled(snapshot, selectPrioritizedCue(snapshot, timestampMs), rotated);
  }

  getClassificationDiagnostics() { return this.pull.getClassificationDiagnostics(); }
}

/** A sideways picture explains why nothing arms; once armed, tracking works and wins. */
function levelled<T extends LiveCoachSnapshot>(snapshot: T, cue: LiveCoachCue, rotated: boolean) {
  return { snapshot, cue: rotated && snapshot.phase === "unknown" ? CAMERA_ROTATED_CUE : cue };
}
