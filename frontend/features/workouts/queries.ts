import { queryOptions } from "@tanstack/react-query";

import { fetchActiveWorkoutSession, fetchWorkoutMovements, fetchWorkoutSessions } from "./api";
import { workoutKeys } from "./keys";

// The logger reconciles unfinished sessions from this data, so it always
// revalidates on mount. The cached copy still renders immediately.
export const workoutSessionsQuery = () =>
  queryOptions({
    queryKey: workoutKeys.all,
    queryFn: fetchWorkoutSessions,
    staleTime: 0,
  });

export const activeWorkoutQuery = () =>
  queryOptions({
    queryKey: workoutKeys.active,
    queryFn: fetchActiveWorkoutSession,
    staleTime: 0,
  });

// Published movement names change rarely.
export const workoutMovementsQuery = () =>
  queryOptions({
    queryKey: workoutKeys.movements,
    queryFn: fetchWorkoutMovements,
    staleTime: 5 * 60_000,
  });
