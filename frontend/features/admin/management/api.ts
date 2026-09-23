import { authApiFetch } from "@/lib/auth-api";

export type Page<T> = { page: number; page_size: number; total: number; items: T[] };
export type UserRow = { id: string; display_name: string; role: string; created_at: string; onboarding_complete: boolean; analysis_count: number };
export type UsageTotals = Record<string, { consumed: number; reserved: number }>;
export type UserDetail = { id: string; display_name: string; role: string; created_at: string; onboarding_completed_at: string | null; effective_plan: string; usage_window: { start: string; end: string }; usage: UsageTotals; entitlements: { feature_key: string; type: string; enabled: boolean; allowance_units: number | null }[] };
export type AnalysisRow = { id: string; user_id: string | null; owner_name: string | null; owner_kind: string; status: string; stage: string; created_at: string; completed_at: string | null; failed_at: string | null; attempts: number; terminal_outcome: string | null; movement_id: string | null; movement_name: string | null };
export type AnalysisDetail = AnalysisRow & { valid_rep_count: number | null; partial_rep_count: number | null; uncertain_rep_count: number | null; explanation_status: string; failure_detail: string | null };
export type UsageRow = { user_id: string; display_name: string; effective_plan: string; usage: UsageTotals };
export type UsagePage = Page<UsageRow> & { usage_window: { start: string; end: string } };
export type PlanRow = { id: string; user_id: string; owner_name: string; title: string; saved_at: string };
export type PlanDetail = PlanRow & { document_status: "valid" | "invalid"; plan_document: { title: string; summary: string | null; days: { day_index: number; label: string | null; exercises: { movement_id: string; sets: number; reps: number | null; hold_seconds: number | null; rest_seconds: number; notes: string | null }[] }[] } | null };

const params = (values: Record<string, string | number | undefined>) => {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) if (value !== undefined && value !== "") query.set(key, String(value));
  return query.toString();
};

export const listUsers = (page: number, q: string, role: string) => authApiFetch<Page<UserRow>>(`/admin/management/users?${params({ page, page_size: 20, q, role })}`);
export const getUser = (id: string) => authApiFetch<UserDetail>(`/admin/management/users/${encodeURIComponent(id)}`);
export const listAnalyses = (page: number, status: string, owner: string) => authApiFetch<Page<AnalysisRow>>(`/admin/management/analyses?${params({ page, page_size: 20, status, owner })}`);
export const getAnalysis = (id: string) => authApiFetch<AnalysisDetail>(`/admin/management/analyses/${encodeURIComponent(id)}`);
export const listUsage = (page: number, q: string) => authApiFetch<UsagePage>(`/admin/management/usage?${params({ page, page_size: 20, q })}`);
export const listPlans = (page: number) => authApiFetch<Page<PlanRow>>(`/admin/management/plans?${params({ page, page_size: 20 })}`);
export const getPlan = (id: string) => authApiFetch<PlanDetail>(`/admin/management/plans/${encodeURIComponent(id)}`);
