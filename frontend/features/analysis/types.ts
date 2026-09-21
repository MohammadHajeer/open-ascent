import type { GuestResult } from "@/lib/analysis";

export type AuthenticatedAnalysisAccess = {
  analysis_id: string;
  kind: "authenticated";
};

export type AnalysisHistoryItem = {
  analysis_id: string;
  status: string;
  stage: string;
  movement: { id: string | null; slug: string; name: string };
  created_at: string;
  completed_at: string | null;
  terminal_outcome: string | null;
  valid_rep_count: number | null;
  partial_rep_count: number | null;
  uncertain_rep_count: number | null;
  explanation_status: string;
};

export type AuthenticatedAnalysisResult = GuestResult;
