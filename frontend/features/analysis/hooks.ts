"use client";

import { useQuery } from "@tanstack/react-query";

import { analysisHistoryQuery, analysisResultQuery } from "./queries";

export function useAnalysisHistory(limit = 50) {
  return useQuery(analysisHistoryQuery(limit));
}

export function useAnalysisResult(id: string) {
  return useQuery(analysisResultQuery(id));
}
