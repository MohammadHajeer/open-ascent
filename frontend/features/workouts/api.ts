import { authApiFetch } from "@/lib/auth-api";

import type {
  MovementOption,
  WorkoutSession,
  WorkoutSessionDetail,
  WorkoutSet,
  WorkoutSetInput,
} from "./types";

export const fetchWorkoutSessions = () =>
  authApiFetch<WorkoutSession[]>("/workout-sessions", { cache: "no-store" });

export const fetchWorkoutSession = (sessionId: string) =>
  authApiFetch<WorkoutSessionDetail>(`/workout-sessions/${sessionId}`, {
    cache: "no-store",
  });

export const createWorkoutSession = () =>
  authApiFetch<WorkoutSessionDetail>("/workout-sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ source: "manual" }),
  });

export const addWorkoutSet = (sessionId: string, payload: WorkoutSetInput) =>
  authApiFetch<WorkoutSet>(`/workout-sessions/${sessionId}/sets`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

export const finishWorkoutSession = (
  sessionId: string,
  options?: { notes?: string; completedAt?: string },
) =>
  authApiFetch<WorkoutSessionDetail>(`/workout-sessions/${sessionId}/finish`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...(options?.notes ? { notes: options.notes } : {}),
      ...(options?.completedAt ? { completed_at: options.completedAt } : {}),
    }),
  });

export const discardWorkoutSession = (sessionId: string) =>
  authApiFetch<{ discarded: boolean }>(`/workout-sessions/${sessionId}`, { method: "DELETE" });

export async function fetchWorkoutMovements(): Promise<MovementOption[]> {
  const movements = await authApiFetch<Array<{ id: string; name: string }>>(
    "/movements",
    { cache: "no-store" },
  );
  return movements.map(({ id, name }) => ({ id, name }));
}
