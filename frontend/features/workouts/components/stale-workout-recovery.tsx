"use client";

import { useState } from "react";
import { AlertCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { formatSessionTime } from "../duration";
import type { WorkoutLoggerController } from "../use-workout-logger";

export function StaleWorkoutRecovery({ controller }: { controller: WorkoutLoggerController }) {
  const [finishTime, setFinishTime] = useState("");
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const active = controller.active;
  if (!active) return null;
  const lastSet = active.sets.reduce<string | null>((latest, item) =>
    !latest || item.created_at > latest ? item.created_at : latest, null);

  return (
    <section className="bg-card/70 px-5 py-7 sm:px-7" aria-labelledby="stale-workout-title">
      <div className="flex items-center gap-3 text-primary">
        <AlertCircle className="size-5" aria-hidden="true" />
        <p className="font-mono text-[0.62rem] font-semibold tracking-[0.18em] uppercase">Open workout</p>
      </div>
      <h2 id="stale-workout-title" className="mt-3 text-2xl font-medium tracking-tight">
        Your workout from {formatSessionTime(active.started_at)} is still open.
      </h2>
      <p className="mt-2 max-w-xl text-sm leading-6 text-foreground-soft">
        Resume logging, or choose when you actually finished. Time away is not counted as workout time automatically.
      </p>
      <Button type="button" className="mt-5" onClick={controller.resumeStale}>Resume workout</Button>

      <div className="mt-7 max-w-md border-t border-border/70 pt-5">
        <Label htmlFor="stale-workout-finish">When did you finish?</Label>
        {lastSet ? (
          <p className="mt-2 text-xs text-foreground-faint">
            Last set logged at {formatSessionTime(lastSet)}. This may differ from your finish time.
          </p>
        ) : null}
        <Input
          id="stale-workout-finish"
          type="datetime-local"
          className="mt-2"
          value={finishTime}
          onChange={(event) => setFinishTime(event.target.value)}
        />
        <Button
          type="button"
          variant="outline"
          className="mt-3"
          disabled={!finishTime || controller.isWorking}
          onClick={() => void controller.completeStale(finishTime)}
        >
          Finish workout at this time
        </Button>
      </div>

      {active.sets.length === 0 ? (
        <div className="mt-6 border-t border-border/70 pt-5">
          {confirmDiscard ? (
            <div className="flex flex-wrap items-center gap-3">
              <p className="text-sm">Discard this empty workout permanently?</p>
              <Button type="button" variant="destructive" disabled={controller.isWorking} onClick={() => void controller.discardEmpty()}>Confirm discard</Button>
              <Button type="button" variant="ghost" onClick={() => setConfirmDiscard(false)}>Cancel</Button>
            </div>
          ) : (
            <Button type="button" variant="ghost" onClick={() => setConfirmDiscard(true)}>Discard empty workout</Button>
          )}
        </div>
      ) : null}
    </section>
  );
}
