import type { WorkoutSession } from "./types.ts";

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
