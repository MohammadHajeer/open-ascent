"use client";

import { Dumbbell, Loader2, Plus, Timer } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import type { WorkoutLoggerController } from "../use-workout-logger";
import { Field } from "./field";
import { LoggingDetails } from "./logging-details";

export function WorkoutSetForm({ controller }: { controller: WorkoutLoggerController }) {
  return (
    <form
      onSubmit={(event) => { event.preventDefault(); void controller.saveSet(); }}
      noValidate
      className="bg-card/70 p-5 sm:p-7"
    >
      <div className="mt-6 space-y-6">
        <Field id="workout-movement" label="Movement" hint="What did you train?">
          <Select
            items={controller.movementItems}
            value={controller.movementId || null}
            onValueChange={(selected) => {
              controller.setMovementId(selected ?? "");
              controller.setAnalysisId("");
            }}
          >
            <SelectTrigger id="workout-movement" className="h-12 w-full rounded-xl bg-background/70" aria-describedby="workout-movement-hint">
              <SelectValue placeholder="Choose movement" />
            </SelectTrigger>
            <SelectContent>
              {controller.movementItems.map((item) => (
                <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {controller.movements.isError ? (
            <p role="alert" className="text-sm text-destructive">Movements could not be loaded. Try again in a moment.</p>
          ) : null}
        </Field>

        <div className="grid gap-5 md:grid-cols-[0.9fr_1.1fr]">
          <Field id="workout-measurement-reps" label="Measurement" hint="Repetition set or timed hold">
            <div role="group" aria-label="Measurement" className="grid grid-cols-2 rounded-xl border border-border/80 bg-background/40 p-1">
              <Button id="workout-measurement-reps" type="button" aria-pressed={controller.measurement === "reps"} variant={controller.measurement === "reps" ? "default" : "ghost"} className="h-9 rounded-lg" onClick={() => {
                controller.setMeasurement("reps");
                controller.setValue("");
              }}>
                <Dumbbell className="size-4" aria-hidden="true" /> Reps
              </Button>
              <Button type="button" aria-pressed={controller.measurement === "hold"} variant={controller.measurement === "hold" ? "default" : "ghost"} className="h-9 rounded-lg" onClick={() => {
                controller.setMeasurement("hold");
                controller.setValue("");
              }}>
                <Timer className="size-4" aria-hidden="true" /> Hold
              </Button>
            </div>
          </Field>

          <Field id="workout-value" label={controller.measurement === "reps" ? "Repetitions" : "Hold duration"} hint={controller.measurement === "reps" ? "Completed reps" : "Time under hold"}>
            <div className="relative">
              <Input
                id="workout-value"
                className="h-12 rounded-xl bg-background/70 pr-16 text-base"
                type="number"
                min={controller.measurement === "reps" ? 1 : 0.1}
                step={controller.measurement === "reps" ? 1 : 0.1}
                value={controller.value}
                onChange={(event) => controller.setValue(event.target.value)}
                placeholder={controller.measurement === "reps" ? "8" : "12"}
                aria-describedby={`workout-value-hint${controller.setError ? " workout-set-error" : ""}`}
                aria-invalid={Boolean(controller.setError)}
                required
              />
              <span className="pointer-events-none absolute inset-y-0 right-4 flex items-center text-xs text-foreground-faint">
                {controller.measurement === "reps" ? "reps" : "sec"}
              </span>
            </div>
          </Field>
        </div>

        <LoggingDetails controller={controller} />

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/70 pt-5">
          <p className="text-xs text-foreground-faint">Set {controller.nextPosition + 1} will be added to the current workout.</p>
          <Button size="lg" type="submit" disabled={controller.isWorking || controller.session.isPending}>
            {controller.addSet.isPending ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
            {controller.addSet.isPending ? "Adding…" : "Add set"}
          </Button>
        </div>
        {controller.setError ? (
          <p id="workout-set-error" role="alert" className="text-sm text-destructive">{controller.setError}</p>
        ) : null}
      </div>
    </form>
  );
}
