import type { WorkoutSession } from "./types.ts";

export function incrementActiveSetCount(
  current: WorkoutSession | null | undefined,
  sessionId: string,
): WorkoutSession | null | undefined {
  return current?.id === sessionId
    ? { ...current, set_count: current.set_count + 1 }
    : current;
}

export function clearActiveWorkout(
  current: WorkoutSession | null | undefined,
  sessionId: string,
): WorkoutSession | null | undefined {
  return current?.id === sessionId ? null : current;
}
