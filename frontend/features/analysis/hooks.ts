"use client";

import { useQuery } from "@tanstack/react-query";

import { fetchAnalysisHistory, fetchAuthenticatedAnalysisResult } from "./api";
import { analysisKeys } from "./keys";

export function useAnalysisHistory(limit = 50) {
  return useQuery({
    queryKey: analysisKeys.history(limit),
    queryFn: () => fetchAnalysisHistory(limit),
  });
}

export function useAnalysisResult(id: string) {
  return useQuery({
    queryKey: analysisKeys.result(id),
    queryFn: () => fetchAuthenticatedAnalysisResult(id),
    enabled: Boolean(id),
  });
}
