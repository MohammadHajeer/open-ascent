export const workoutKeys = {
  all: ["workout-sessions"] as const,
  detail: (sessionId: string) => ["workout-sessions", sessionId] as const,
  movements: ["workout-movements"] as const,
};
