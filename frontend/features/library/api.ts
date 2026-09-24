import { authApiFetch } from "@/lib/auth-api";

export type SavedPlanSummary = {
  id: string;
  title: string;
  summary: string | null;
  saved_at: string;
  training_day_count: number;
  movement_count: number;
};

export type SavedPlanExercise = {
  movement_id: string;
  movement_name: string;
  movement_slug: string | null;
  sets: number;
  reps: number | null;
  hold_seconds: number | null;
  rest_seconds: number;
  notes: string | null;
};

export type SavedPlanDetailData = SavedPlanSummary & {
  days: { day_index: number; label: string | null; exercises: SavedPlanExercise[] }[];
};

export const listSavedPlans = () =>
  authApiFetch<SavedPlanSummary[]>("/coach/plans", { cache: "no-store" });

export const getSavedPlan = (planId: string) =>
  authApiFetch<SavedPlanDetailData>(`/coach/plans/${encodeURIComponent(planId)}`, { cache: "no-store" });
