export type MovementChoice = { id: string; name: string };

export type OnboardingConfig = {
  safety_version: string;
  safety_guidance: string[];
  skill_movements: MovementChoice[];
  avoidance_movements: MovementChoice[];
};
