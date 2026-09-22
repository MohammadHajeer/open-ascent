import { Clock3, History } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

import { completedDuration, formatSessionTime } from "../duration";
import type { WorkoutSession } from "../types";

export function RecentSessions({
  sessions,
  onResume,
}: {
  sessions: WorkoutSession[];
  onResume: (sessionId: string) => void;
}) {
  return (
    <section className="border-t border-border/75 bg-card/45 px-5 py-5 sm:px-7" aria-labelledby="recent-sessions-title">
      <div className="flex items-center gap-2">
        <History className="size-4 text-primary" aria-hidden="true" />
        <h3 id="recent-sessions-title" className="font-mono text-[0.62rem] font-semibold tracking-[0.18em] text-primary uppercase">
          Recent sessions
        </h3>
      </div>

      {sessions.length ? (
        <ul className="mt-4 grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
          {sessions.map((session) => (
            <li key={session.id} className="flex min-w-0 items-center justify-between gap-3 rounded-2xl border border-border/70 bg-background/40 px-4 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{formatSessionTime(session.started_at)}</p>
                <p className="mt-1 text-xs text-foreground-faint">
                  {session.set_count} {session.set_count === 1 ? "set" : "sets"}
                  {session.completed_at
                    ? ` · ${completedDuration(session.started_at, session.completed_at)}`
                    : " · in progress"}
                </p>
              </div>
              {session.completed_at ? (
                <Badge variant="outline">Done</Badge>
              ) : (
                <Button type="button" size="sm" variant="outline" onClick={() => onResume(session.id)}>
                  Resume
                </Button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <div className="mt-4 flex items-center gap-2 text-sm text-foreground-faint">
          <Clock3 className="size-4" aria-hidden="true" />
          No sessions logged yet.
        </div>
      )}
    </section>
  );
}
