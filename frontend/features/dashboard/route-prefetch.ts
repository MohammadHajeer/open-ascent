"use client";

import { useCallback } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";

import { analysisHistoryQuery } from "@/features/analysis/queries";
import { athleteProfileQuery } from "@/features/profile/queries";
import { generationOptionsQuery, savedPlansQuery } from "@/features/library/queries";
import { progressSummaryQuery } from "@/features/progress/queries";
import { subscriptionStatusQuery } from "@/features/subscription/queries";
import {
  activeWorkoutQuery,
  workoutMovementsQuery,
  workoutSessionsQuery,
} from "@/features/workouts/queries";

import { dashboardContextQuery } from "./queries";

// Hovering back and forth over a link must not re-request queries that always
// revalidate (staleTime 0); every other query keeps its own freshness rules.
const PREFETCH_STALE_TIME = 10_000;

function forPrefetch<T extends { staleTime?: unknown }>(query: T): T {
  return query.staleTime === 0 ? { ...query, staleTime: PREFETCH_STALE_TIME } : query;
}

// Queries each dashboard page reads on mount. Warming them when the pointer or
// keyboard focus reaches a nav link lets the page render from cache on arrival.
// Authorization is unchanged: these are the same bearer-token API calls.
const routePrefetchers: Record<string, (queryClient: QueryClient) => void> = {
  "/dashboard": (qc) => {
    void qc.prefetchQuery(dashboardContextQuery());
    void qc.prefetchQuery(forPrefetch(workoutSessionsQuery()));
    void qc.prefetchQuery(progressSummaryQuery());
    void qc.prefetchQuery(analysisHistoryQuery(5));
  },
  "/dashboard/train": (qc) => {
    void qc.prefetchQuery(forPrefetch(workoutSessionsQuery()));
    void qc.prefetchQuery(forPrefetch(activeWorkoutQuery()));
    void qc.prefetchQuery(workoutMovementsQuery());
  },
  "/dashboard/progress": (qc) => {
    void qc.prefetchQuery(progressSummaryQuery());
  },
  "/dashboard/library": (qc) => {
    void qc.prefetchQuery(savedPlansQuery());
    void qc.prefetchQuery(forPrefetch(generationOptionsQuery()));
  },
  "/dashboard/analyses": (qc) => {
    void qc.prefetchQuery(analysisHistoryQuery());
  },
  "/dashboard/profile": (qc) => {
    void qc.prefetchQuery(athleteProfileQuery());
  },
  "/dashboard/settings": (qc) => {
    void qc.prefetchQuery(forPrefetch(subscriptionStatusQuery()));
  },
};

export function usePrefetchDashboardRoute() {
  const queryClient = useQueryClient();

  return useCallback(
    (href: string) => routePrefetchers[href]?.(queryClient),
    [queryClient],
  );
}
