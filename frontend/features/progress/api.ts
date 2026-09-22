import { authApiFetch } from "@/lib/auth-api";

import type { ProgressSummary } from "./types";

export const fetchProgressSummary = () =>
  authApiFetch<ProgressSummary>("/progress/summary", { cache: "no-store" });
