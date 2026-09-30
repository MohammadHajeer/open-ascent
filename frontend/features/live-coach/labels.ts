import type { LiveCoachMovement, MuscleUpPhase, PullUpPhase } from "./types.ts";

// Short display names for headline use (Focus Mode). The vertical-pull family
// can't see palm direction, so it can't claim chin-up specifically.
export const MOVEMENT_NAMES: Record<LiveCoachMovement, string> = {
  "vertical-pull": "Pull-Up",
  "push-up": "Push-Up",
  "muscle-up": "Muscle-Up",
  dips: "Dip",
};

const PHASE_LABELS: Record<PullUpPhase, string> = {
  unknown: "Setting up",
  bottom: "Hang",
  rising: "Pulling",
  top: "Top",
  lowering: "Lowering",
};

const PUSH_UP_PHASE_LABELS: Record<PullUpPhase, string> = {
  ...PHASE_LABELS, bottom: "Bottom", rising: "Pressing up",
};

const MUSCLE_UP_PHASE_LABELS: Record<MuscleUpPhase, string> = {
  ...PHASE_LABELS, transition: "Transition", top: "Support", lowering: "Returning",
};

const DIP_PHASE_LABELS: Record<PullUpPhase, string> = {
  unknown: "Setting up", top: "Support", lowering: "Lowering",
  bottom: "Bottom", rising: "Pressing up",
};

export function phaseLabels(movement: LiveCoachMovement): Record<MuscleUpPhase, string> {
  if (movement === "muscle-up") return MUSCLE_UP_PHASE_LABELS;
  const labels = movement === "dips" ? DIP_PHASE_LABELS : movement === "push-up" ? PUSH_UP_PHASE_LABELS : PHASE_LABELS;
  return { ...labels, transition: "Transition" };
}
