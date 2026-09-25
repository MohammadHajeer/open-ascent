import { authApiFetch } from "@/lib/auth-api";
import type { PlanOrigin } from "@/features/coach/types";

export type SavedPlanSummary = {
  id: string;
  title: string;
  summary: string | null;
  origin?: PlanOrigin | null;
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

export type PlanMode = "profile" | "goal" | "progress";
export type GenerationOptions = { goals: { id: string; name: string }[]; progress_available: boolean; plan_allowance: number | null; plan_remaining: number | null };
export const getGenerationOptions = () =>
  authApiFetch<GenerationOptions>("/coach/plans/generation-options", { cache: "no-store" });
export const startLibraryPlan = (request: {
  client_request_id: string;
  mode: PlanMode;
  goal_movement_id?: string;
  goal_focus?: "general_pulling_strength";
  note?: string;
}) => authApiFetch<{ conversation_id: string; generation_id: string; created: boolean }>(
  "/coach/plans/generations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(request) }
);
