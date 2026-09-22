import { AlertCircle } from "lucide-react";

import { Button } from "@/components/ui/button";

import { formatSessionTime } from "../duration";
import type { WorkoutSession } from "../types";

export function SessionRecovery({
  sessions,
  onResume,
}: {
  sessions: WorkoutSession[];
  onResume: (sessionId: string) => void;
}) {
  return (
    <section className="bg-card/70 px-5 py-7 sm:px-7" aria-labelledby="resume-workout-title">
      <div className="flex items-center gap-3 text-primary">
        <AlertCircle className="size-5" aria-hidden="true" />
        <p className="font-mono text-[0.62rem] font-semibold tracking-[0.18em] uppercase">Session recovery</p>
      </div>
      <h2 id="resume-workout-title" className="mt-3 text-2xl font-medium tracking-tight">
        Choose a workout to resume.
      </h2>
      <p className="mt-2 max-w-xl text-sm leading-6 text-foreground-soft">
        More than one workout is still open. Choose the session you want to continue.
      </p>
      <ul className="mt-5 grid gap-3 sm:grid-cols-2">
        {sessions.map((session) => (
          <li key={session.id} className="flex items-center justify-between gap-3 rounded-2xl border border-border/75 bg-background/40 p-4">
            <div>
              <p className="text-sm font-medium">{formatSessionTime(session.started_at)}</p>
              <p className="mt-1 text-xs text-foreground-faint">{session.set_count} {session.set_count === 1 ? "set" : "sets"} logged</p>
            </div>
            <Button type="button" variant="outline" onClick={() => onResume(session.id)}>Resume</Button>
          </li>
        ))}
      </ul>
    </section>
  );
}
