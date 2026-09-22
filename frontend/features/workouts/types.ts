export type WorkoutSource =
  | "manual"
  | "self_reported"
  | "uploaded_analysis"
  | "live_coach";

export type WorkoutPerformer = "self" | "other" | "unknown";
export type WorkoutIntent =
  | "training_set"
  | "assessment"
  | "max_test"
  | "skill_attempt";

export type WorkoutSet = {
  id: string;
  session_id: string;
  movement_id: string;
  movement_name: string;
  position: number;
  source: WorkoutSource;
  performer: WorkoutPerformer;
  intent: WorkoutIntent;
  reps: number | null;
  hold_seconds: string | null;
  analysis_id: string | null;
  live_coach_session_ref: string | null;
  created_at: string;
  updated_at: string;
};

export type WorkoutSession = {
  id: string;
  source: WorkoutSource;
  started_at: string;
  completed_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type WorkoutSessionDetail = WorkoutSession & { sets: WorkoutSet[] };

export type WorkoutSetInput = {
  movement_id: string;
  position: number;
  source: WorkoutSource;
  performer: WorkoutPerformer;
  intent: WorkoutIntent;
  reps?: number;
  hold_seconds?: number;
  analysis_id?: string;
  live_coach_session_ref?: string;
};

export type MovementOption = { id: string; name: string };
