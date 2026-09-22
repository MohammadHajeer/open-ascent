import { elapsedSeconds, formatElapsed, formatSessionTime } from "./duration.ts";
import { isStaleSession } from "./recovery.ts";
import type { WorkoutSession } from "./types.ts";

export function getActiveWorkoutPresentation(
  session: WorkoutSession | null | undefined,
  nowMs: number | null,
  pathname: string,
) {
  if (!session || session.completed_at || pathname === "/dashboard/train" || nowMs === null) {
    return null;
  }

  const stale = isStaleSession(session.started_at, nowMs);
  const started = new Date(session.started_at);
  const yesterday = new Date(nowMs);
  yesterday.setDate(yesterday.getDate() - 1);
  const startedYesterday = started.toDateString() === yesterday.toDateString();

  return {
    stale,
    title: stale ? "Workout still open" : "Workout in progress",
    detail: stale
      ? startedYesterday ? "Started yesterday" : `Started ${formatSessionTime(session.started_at)}`
      : formatElapsed(elapsedSeconds(session.started_at, nowMs)),
    action: stale ? "Resolve" : "Resume",
    actionLabel: stale
      ? "Resolve open workout on Train"
      : "Resume active workout on Train",
    href: "/dashboard/train",
  };
}
