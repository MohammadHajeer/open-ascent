import type { WorkoutSession } from "./types.ts";

export function isStaleSession(startedAt: string, nowMs: number): boolean {
  const started = new Date(startedAt);
  const now = new Date(nowMs);
  if (!Number.isFinite(started.getTime())) return false;
  return nowMs - started.getTime() >= 8 * 60 * 60 * 1000 ||
    started.toDateString() !== now.toDateString();
}

export function resolveSessionRecovery(
  sessions: WorkoutSession[],
  selectedSessionId: string | null,
) {
  const unfinishedSessions = sessions
    .filter((item) => !item.completed_at)
    .toSorted(
      (left, right) =>
        right.started_at.localeCompare(left.started_at) ||
        right.id.localeCompare(left.id),
    );
  const selectedIsOpen = unfinishedSessions.some(
    (item) => item.id === selectedSessionId,
  );
  const recoveryNeeded = !selectedIsOpen && unfinishedSessions.length > 1;
  const activeSessionId = selectedIsOpen
    ? selectedSessionId
    : unfinishedSessions.length === 1
      ? unfinishedSessions[0].id
      : null;

  return { unfinishedSessions, recoveryNeeded, activeSessionId };
}
