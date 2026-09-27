export type Conversation = { id: string; title: string; created_at: string; updated_at: string };
export type CoachMessage = { id: string; role: "user" | "assistant"; content: string; status: "streaming" | "completed" | "failed" | "interrupted"; created_at: string; generation_id: string | null; plan_preview_id?: string | null };
export type ConversationDetail = Conversation & { messages: CoachMessage[] };
export type Generation = { id: string; status: CoachMessage["status"] | "reserved" | "requesting"; content: string; error_code: string | null };
export type SupportingExerciseDetails = { key: string; name: string; purpose: string; setup: string[]; execution: string[]; common_mistakes: string[]; equipment: string[]; target: "reps" | "hold_seconds" };
/** A canonical movement or a curated supporting exercise; version 1 plans only contain movements. */
export type PlanExercise = { movement_id: string | null; supporting_exercise_id?: string | null; exercise_kind?: "movement" | "supporting"; movement_name: string; movement_slug: string | null; sets: number; reps: number | null; hold_seconds: number | null; rest_seconds: number; notes: string | null; explanation?: string | null; supporting?: SupportingExerciseDetails | null };
export type PlanOrigin = { mode: "profile" | "goal" | "progress"; goal_name: string | null; based_on: string[]; note: string | null };
export type PlanPreview = { id: string; saved_plan_id: string | null; title: string; summary: string | null; origin?: PlanOrigin | null; provisional_readiness?: boolean; days: { day_index: number; label: string | null; exercises: PlanExercise[] }[] };
/** Server-authoritative Coach message allowance; display only, never admission. */
export type CoachUsage = { tier: "free" | "pro"; allowed: boolean; unlimited: boolean; limit: number | null; used: number; remaining: number | null; period: "day" | "month" | null; resets_at: string | null };
export const COACH_QUOTA_EXHAUSTED = "coach_daily_quota_exhausted";
