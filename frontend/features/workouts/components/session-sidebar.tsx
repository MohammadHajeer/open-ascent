"use client";

import { Check, Dumbbell, Loader2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

import type { WorkoutLoggerController } from "../use-workout-logger";

export function SessionSidebar({ controller }: { controller: WorkoutLoggerController }) {
  const sets = controller.active?.sets ?? [];

  return (
    <aside className="bg-card/55 p-5 sm:p-6 xl:sticky xl:top-24 xl:self-start">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="font-mono text-[0.62rem] font-semibold tracking-[0.18em] text-primary uppercase">Session</p>
          <h3 className="mt-2 text-lg font-medium">Logged sets</h3>
        </div>
        <Badge variant="outline">{sets.length} {sets.length === 1 ? "set" : "sets"}</Badge>
      </div>

      <div className="mt-5 max-h-[28rem] space-y-2.5 overflow-y-auto pr-1 xl:max-h-[min(46vh,32rem)]">
        {sets.length ? sets.map((item, index) => (
          <div key={item.id} className="rounded-2xl border border-border/70 bg-background/45 p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[0.65rem] font-medium tracking-wide text-foreground-faint uppercase">Set {index + 1}</p>
                <p className="mt-1 truncate text-sm font-medium">{item.movement_name}</p>
              </div>
              <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                <Check className="size-3.5" aria-hidden="true" />
              </span>
            </div>
            <p className="mt-3 text-lg font-medium tracking-tight">
              {item.reps !== null ? `${item.reps} reps` : `${Number(item.hold_seconds)} sec`}
            </p>
            <p className="mt-2 text-[0.65rem] capitalize text-foreground-faint">
              {item.source.replaceAll("_", " ")} · {item.intent.replaceAll("_", " ")}
            </p>
          </div>
        )) : (
          <div className="rounded-2xl border border-dashed border-border/80 px-4 py-8 text-center">
            <Dumbbell className="mx-auto size-5 text-foreground-faint" aria-hidden="true" />
            <p className="mt-3 text-sm text-foreground-soft">Add your first set.</p>
            <p className="mt-1 text-xs text-foreground-faint">It will appear here as you train.</p>
          </div>
        )}
      </div>

      <div className="mt-6 border-t border-border/70 pt-5">
        <Label htmlFor="workout-notes">Session notes</Label>
        <Textarea
          id="workout-notes"
          className="mt-2 min-h-24 rounded-xl bg-background/60"
          value={controller.notes}
          onChange={(event) => controller.setNotes(event.target.value)}
          maxLength={2000}
          placeholder="Optional notes about this session…"
        />
      </div>

      <Button
        type="button"
        className="mt-4 w-full"
        size="lg"
        variant="outline"
        onClick={() => void controller.complete()}
        disabled={controller.isWorking || controller.session.isPending || (!sets.length && !controller.pendingSet)}
      >
        {controller.isWorking ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
        {controller.finish.isPending
          ? "Finishing…"
          : controller.isWorking && controller.pendingSet
            ? "Saving set…"
            : controller.pendingSet
              ? "Save set & finish"
              : controller.isStale
                ? "Choose finish time"
                : "Finish workout"}
      </Button>
      {!sets.length && !controller.pendingSet ? (
        <p className="mt-2 text-center text-xs text-foreground-faint">Log a set before finishing.</p>
      ) : null}
    </aside>
  );
}
