import { authApiFetch } from "@/lib/auth-api";

export type DashboardContext = {
  display_name: string;
  primary_goal: string | null;
  days_per_week: number | null;
  latest_plan: {
    id: string;
    title: string;
    summary: string | null;
    saved_at: string;
    days: {
      day_index: number;
      label: string | null;
      exercises: { movement_name: string; sets: number; reps: number | null; hold_seconds: number | null }[];
    }[];
  } | null;
};

export const fetchDashboardContext = () =>
  authApiFetch<DashboardContext>("/dashboard/context", { cache: "no-store" });
