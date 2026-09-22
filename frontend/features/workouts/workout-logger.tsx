"use client";

import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";

import { ActiveWorkoutView } from "./components/active-workout-view";
import { RecentSessions } from "./components/recent-sessions";
import { SessionRecovery } from "./components/session-recovery";
import { WorkoutStartView } from "./components/workout-start-view";
import { useWorkoutLogger } from "./use-workout-logger";

export function WorkoutLogger() {
  const controller = useWorkoutLogger();

  if (controller.sessions.isPending) {
    return (
      <div className="grid min-h-72 place-items-center">
        <Loader2 className="size-6 animate-spin text-primary" aria-label="Loading workouts" />
      </div>
    );
  }

  if (controller.sessions.isError || (controller.activeSessionId && controller.session.isError)) {
    return (
      <div className="flex min-h-72 flex-col items-center justify-center gap-4 text-center">
        <p role="alert" className="text-sm text-destructive">
          Workout history could not be loaded. Try again before logging a set.
        </p>
        <Button type="button" variant="outline" onClick={() => {
          void controller.sessions.refetch();
          if (controller.activeSessionId) void controller.session.refetch();
        }}>Retry</Button>
      </div>
    );
  }

  return (
    <div>
      {controller.recoveryNeeded ? (
        <SessionRecovery sessions={controller.unfinishedSessions} onResume={controller.selectSession} />
      ) : controller.activeSessionId ? (
        <ActiveWorkoutView controller={controller} />
      ) : (
        <WorkoutStartView onStart={() => void controller.begin()} isPending={controller.start.isPending} />
      )}
      <RecentSessions sessions={controller.recentSessions} onResume={controller.selectSession} />
    </div>
  );
}
