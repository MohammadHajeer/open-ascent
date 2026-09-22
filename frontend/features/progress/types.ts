export type ProgressMeasurement = "reps" | "hold_seconds";

export type ProgressTrendPoint = {
  recorded_at: string;
  value: number;
  source: "manual" | "self_reported" | "uploaded_analysis" | "live_coach";
  intent: "training_set" | "assessment" | "max_test" | "skill_attempt";
  workout_session_id: string;
  workout_set_id: string;
};

export type ProgressMetricSeries = {
  measurement: ProgressMeasurement;
  label: string;
  unit: "reps" | "seconds";
  points: ProgressTrendPoint[];
};

export type ProgressMovement = {
  id: string;
  name: string;
  metrics: ProgressMetricSeries[];
};

export type ProgressSummary = {
  consistency: {
    week_started_at: string;
    workouts_this_week: number;
    active_days_this_week: number;
    sets_this_week: number;
  };
  movements: ProgressMovement[];
};
