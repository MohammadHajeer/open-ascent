import { Loader2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";

import type { WorkoutLoggerController } from "../use-workout-logger";
import { SessionSidebar } from "./session-sidebar";
import { SessionTimer } from "./session-timer";
import { WorkoutSetForm } from "./workout-set-form";

export function ActiveWorkoutView({ controller }: { controller: WorkoutLoggerController }) {
  if (!controller.active) {
    return (
      <div className="grid min-h-72 place-items-center">
        <Loader2 className="size-6 animate-spin text-primary" aria-label="Loading workout" />
      </div>
    );
  }

  return (
    <div className="grid xl:grid-cols-[minmax(0,1fr)_23rem]">
      <div className="border-b border-border/80 xl:border-r xl:border-b-0">
        <div className="flex flex-wrap items-start justify-between gap-4 bg-card/70 px-5 pt-6 sm:px-7 sm:pt-7">
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <p className="font-mono text-[0.62rem] font-semibold tracking-[0.18em] text-primary uppercase">Active workout</p>
              <Badge variant="secondary" className="bg-primary/10 text-primary">In progress</Badge>
            </div>
            <h2 className="mt-2 text-2xl font-medium tracking-tight">Build set {controller.nextPosition + 1}</h2>
            <p className="mt-2 text-sm text-foreground-soft">Choose the movement, record the effort, then add it to this session.</p>
          </div>
          <SessionTimer key={controller.active.id} startedAt={controller.active.started_at} />
        </div>
        <WorkoutSetForm controller={controller} />
      </div>
      <SessionSidebar controller={controller} />
    </div>
  );
}
