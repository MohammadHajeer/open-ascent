import { queryOptions } from "@tanstack/react-query";

import { fetchAnalysisHistory, fetchAuthenticatedAnalysisResult } from "./api";
import { analysisKeys } from "./keys";

export const analysisHistoryQuery = (limit = 50) =>
  queryOptions({
    queryKey: analysisKeys.history(limit),
    queryFn: () => fetchAnalysisHistory(limit),
  });

export const analysisResultQuery = (id: string) =>
  queryOptions({
    queryKey: analysisKeys.result(id),
    queryFn: () => fetchAuthenticatedAnalysisResult(id),
    enabled: Boolean(id),
  });
