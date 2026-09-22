"use client";

import { FormEvent, useMemo, useState } from "react";
import {
  Check,
  Clock3,
  Dumbbell,
  History,
  Loader2,
  Plus,
  SlidersHorizontal,
  Timer,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

import {
  useAddWorkoutSet,
  useCreateWorkoutSession,
  useFinishWorkoutSession,
  useWorkoutMovements,
  useWorkoutSession,
  useWorkoutSessions,
} from "./hooks";
import type { WorkoutIntent, WorkoutPerformer, WorkoutSource } from "./types";

const SOURCE_ITEMS = [
  { value: "manual", label: "Manual" },
  { value: "self_reported", label: "Self-reported" },
  { value: "uploaded_analysis", label: "Uploaded analysis" },
  { value: "live_coach", label: "Live Coach" },
] as const;

const PERFORMER_ITEMS = [
  { value: "self", label: "Self" },
  { value: "other", label: "Other person" },
  { value: "unknown", label: "Unknown" },
] as const;

const INTENT_ITEMS = [
  { value: "training_set", label: "Training set" },
  { value: "assessment", label: "Assessment" },
  { value: "max_test", label: "Max test" },
  { value: "skill_attempt", label: "Skill attempt" },
] as const;

function message(error: unknown) {
  return error instanceof Error
    ? error.message
    : "The workout could not be saved.";
}

function formatSessionTime(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

export function WorkoutLogger() {
  const sessions = useWorkoutSessions();
  const movements = useWorkoutMovements();
  const start = useCreateWorkoutSession();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const session = useWorkoutSession(sessionId);
  const addSet = useAddWorkoutSet(sessionId);
  const finish = useFinishWorkoutSession(sessionId);

  const [measurement, setMeasurement] = useState<"reps" | "hold">("reps");
  const [movementId, setMovementId] = useState("");
  const [value, setValue] = useState("");
  const [source, setSource] = useState<WorkoutSource>("manual");
  const [performer, setPerformer] = useState<WorkoutPerformer>("self");
  const [intent, setIntent] = useState<WorkoutIntent>("training_set");
  const [analysisId, setAnalysisId] = useState("");
  const [liveCoachRef, setLiveCoachRef] = useState("");
  const [notes, setNotes] = useState("");
  const [showDetails, setShowDetails] = useState(false);

  const active = session.data;
  const nextPosition = active?.sets.length ?? 0;
  const history = useMemo(
    () =>
      sessions.data?.filter((item) => item.id !== sessionId).slice(0, 5) ?? [],
    [sessions.data, sessionId],
  );
  const movementItems = useMemo(
    () =>
      movements.data?.map((item) => ({
        value: item.id,
        label: item.name,
      })) ?? [],
    [movements.data],
  );

  async function begin() {
    try {
      const created = await start.mutateAsync();
      setSessionId(created.id);
      toast.success("Workout started");
    } catch (error) {
      toast.error(message(error));
    }
  }

  async function submitSet(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const amount = Number(value);

    if (!movementId || !Number.isFinite(amount) || amount <= 0) {
      toast.error("Choose a movement and enter a positive value.");
      return;
    }

    if (measurement === "reps" && !Number.isInteger(amount)) {
      toast.error("Repetitions must be a whole number.");
      return;
    }

    try {
      await addSet.mutateAsync({
        movement_id: movementId,
        position: nextPosition,
        source,
        performer,
        intent,
        ...(measurement === "reps"
          ? { reps: amount }
          : { hold_seconds: amount }),
        ...(source === "uploaded_analysis" && analysisId
          ? { analysis_id: analysisId.trim() }
          : {}),
        ...(source === "live_coach" && liveCoachRef
          ? { live_coach_session_ref: liveCoachRef.trim() }
          : {}),
      });

      setValue("");
      toast.success("Set logged");
    } catch (error) {
      toast.error(message(error));
    }
  }

  async function complete() {
    try {
      await finish.mutateAsync(notes.trim() || undefined);
      setSessionId(null);
      setNotes("");
      setShowDetails(false);
      toast.success("Workout finished");
    } catch (error) {
      toast.error(message(error));
    }
  }

  if (!sessionId) {
    return (
      <div className="grid lg:grid-cols-[minmax(0,1.15fr)_minmax(19rem,0.85fr)]">
        <section className="relative overflow-hidden bg-card/70 p-6 sm:p-7 border-r border-border/80">
          <div className="pointer-events-none absolute -right-12 -top-16 size-52 rounded-full border border-primary/10" />
          <div className="pointer-events-none absolute -right-2 top-10 size-28 rounded-full border border-primary/10" />

          <div className="relative max-w-2xl">
            <div className="flex size-11 items-center justify-center rounded-2xl border border-primary/15 bg-primary/10 text-primary">
              <Dumbbell className="size-5" />
            </div>

            <p className="mt-6 font-mono text-[0.62rem] font-semibold tracking-[0.18em] text-primary uppercase">
              New training session
            </p>
            <h2 className="mt-2 text-2xl font-medium tracking-tight sm:text-3xl">
              Log the work that actually happened.
            </h2>
            <p className="mt-3 max-w-xl text-sm leading-6 text-foreground-soft">
              Record repetitions or timed holds now. Analysis and Live Coach
              evidence can be linked when it belongs to this workout.
            </p>

            <div className="mt-7 flex flex-wrap items-center gap-3">
              <Button size="lg" onClick={begin} disabled={start.isPending}>
                {start.isPending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Plus className="size-4" />
                )}
                {start.isPending ? "Starting…" : "Start workout"}
              </Button>
              <span className="text-xs text-foreground-faint">
                Reps · holds · training evidence
              </span>
            </div>
          </div>
        </section>

        <aside className="bg-card/55 p-5 sm:p-6">
          <div className="flex items-center gap-2">
            <History className="size-4 text-primary" />
            <p className="font-mono text-[0.62rem] font-semibold tracking-[0.18em] text-primary uppercase">
              Recent sessions
            </p>
          </div>

          <div className="mt-5 space-y-2.5">
            {history.length ? (
              history.map((item) => (
                <div
                  key={item.id}
                  className="group flex items-center justify-between gap-4 rounded-2xl border border-border/70 bg-background/45 px-4 py-3.5 transition-colors hover:bg-background/70"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {formatSessionTime(item.started_at)}
                    </p>
                    <p className="mt-1 text-xs text-foreground-faint">
                      {item.completed_at
                        ? "Workout completed"
                        : "Workout in progress"}
                    </p>
                  </div>
                  <span
                    className={
                      item.completed_at
                        ? "rounded-full border border-border/70 px-2.5 py-1 text-[0.65rem] text-foreground-soft"
                        : "rounded-full bg-primary/10 px-2.5 py-1 text-[0.65rem] text-primary"
                    }
                  >
                    {item.completed_at ? "Done" : "Active"}
                  </span>
                </div>
              ))
            ) : (
              <div className="rounded-2xl border border-dashed border-border/80 px-4 py-8 text-center">
                <Clock3 className="mx-auto size-5 text-foreground-faint" />
                <p className="mt-3 text-sm text-foreground-soft">
                  No sessions logged yet.
                </p>
              </div>
            )}
          </div>
        </aside>
      </div>
    );
  }

  return (
    <div className="grid xl:grid-cols-[minmax(0,1fr)_23rem]">
      <form
        onSubmit={submitSet}
        className="bg-card/70 p-5 sm:p-7 border-r border-border/80"
      >
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border/70 pb-6">
          <div>
            <p className="font-mono text-[0.62rem] font-semibold tracking-[0.18em] text-primary uppercase">
              Active workout
            </p>
            <h2 className="mt-2 text-2xl font-medium tracking-tight">
              Build set {nextPosition + 1}
            </h2>
            <p className="mt-2 text-sm text-foreground-soft">
              Choose the movement, record the effort, then add it to this
              session.
            </p>
          </div>

          <span className="rounded-full border border-primary/15 bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary">
            In progress
          </span>
        </div>

        <div className="mt-6 space-y-6">
          <Field label="Movement" hint="What did you train?">
            <Select
              items={movementItems}
              value={movementId || null}
              onValueChange={(selected) => setMovementId(selected ?? "")}
            >
              <SelectTrigger className="h-12 w-full rounded-xl bg-background/70">
                <SelectValue placeholder="Choose movement" />
              </SelectTrigger>
              <SelectContent>
                {movementItems.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <div className="grid gap-5 md:grid-cols-[0.9fr_1.1fr]">
            <Field label="Measurement" hint="Repetition set or timed hold">
              <div className="grid grid-cols-2 rounded-xl border border-border/80 bg-background/40 p-1">
                <Button
                  type="button"
                  variant={measurement === "reps" ? "default" : "ghost"}
                  className="h-9 rounded-lg"
                  onClick={() => {
                    setMeasurement("reps");
                    setValue("");
                  }}
                >
                  <Dumbbell className="size-4" />
                  Reps
                </Button>
                <Button
                  type="button"
                  variant={measurement === "hold" ? "default" : "ghost"}
                  className="h-9 rounded-lg"
                  onClick={() => {
                    setMeasurement("hold");
                    setValue("");
                  }}
                >
                  <Timer className="size-4" />
                  Hold
                </Button>
              </div>
            </Field>

            <Field
              label={measurement === "reps" ? "Repetitions" : "Hold duration"}
              hint={
                measurement === "reps" ? "Completed reps" : "Time under hold"
              }
            >
              <div className="relative">
                <Input
                  className="h-12 rounded-xl bg-background/70 pr-16 text-base"
                  type="number"
                  min={measurement === "reps" ? 1 : 0.1}
                  step={measurement === "reps" ? 1 : 0.1}
                  value={value}
                  onChange={(event) => setValue(event.target.value)}
                  placeholder={measurement === "reps" ? "8" : "12"}
                  required
                />
                <span className="pointer-events-none absolute inset-y-0 right-4 flex items-center text-xs text-foreground-faint">
                  {measurement === "reps" ? "reps" : "sec"}
                </span>
              </div>
            </Field>
          </div>

          <div className="rounded-2xl border border-border/70 bg-background/30">
            <button
              type="button"
              className="flex w-full items-center justify-between gap-4 px-4 py-3.5 text-left"
              onClick={() => setShowDetails((current) => !current)}
            >
              <div className="flex items-center gap-3">
                <div className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <SlidersHorizontal className="size-4" />
                </div>
                <div>
                  <p className="text-sm font-medium">Logging details</p>
                  <p className="mt-0.5 text-xs text-foreground-faint">
                    Source, performer and set intent
                  </p>
                </div>
              </div>
              <span className="text-xs text-foreground-faint">
                {showDetails ? "Hide" : "Edit"}
              </span>
            </button>

            {showDetails && (
              <div className="grid gap-4 border-t border-border/70 px-4 py-4 sm:grid-cols-2">
                <Field label="Source">
                  <Select
                    items={SOURCE_ITEMS}
                    value={source}
                    onValueChange={(selected) => {
                      if (selected) setSource(selected as WorkoutSource);
                    }}
                  >
                    <SelectTrigger className="h-11 rounded-xl bg-background/70">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {SOURCE_ITEMS.map((item) => (
                        <SelectItem key={item.value} value={item.value}>
                          {item.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>

                <Field label="Performer">
                  <Select
                    items={PERFORMER_ITEMS}
                    value={performer}
                    onValueChange={(selected) => {
                      if (selected) setPerformer(selected as WorkoutPerformer);
                    }}
                  >
                    <SelectTrigger className="h-11 rounded-xl bg-background/70">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PERFORMER_ITEMS.map((item) => (
                        <SelectItem key={item.value} value={item.value}>
                          {item.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>

                <Field label="Set intent">
                  <Select
                    items={INTENT_ITEMS}
                    value={intent}
                    onValueChange={(selected) => {
                      if (selected) setIntent(selected as WorkoutIntent);
                    }}
                  >
                    <SelectTrigger className="h-11 rounded-xl bg-background/70">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {INTENT_ITEMS.map((item) => (
                        <SelectItem key={item.value} value={item.value}>
                          {item.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>

                {source === "uploaded_analysis" && (
                  <Field label="Analysis ID">
                    <Input
                      className="h-11 rounded-xl bg-background/70"
                      value={analysisId}
                      onChange={(event) => setAnalysisId(event.target.value)}
                      placeholder="Authenticated analysis UUID"
                      required
                    />
                  </Field>
                )}

                {source === "live_coach" && (
                  <Field label="Live Coach reference" hint="Optional">
                    <Input
                      className="h-11 rounded-xl bg-background/70"
                      value={liveCoachRef}
                      onChange={(event) => setLiveCoachRef(event.target.value)}
                      placeholder="Session reference"
                    />
                  </Field>
                )}
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/70 pt-5">
            <p className="text-xs text-foreground-faint">
              Set {nextPosition + 1} will be added to the current workout.
            </p>
            <Button size="lg" type="submit" disabled={addSet.isPending}>
              {addSet.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Plus className="size-4" />
              )}
              {addSet.isPending ? "Adding…" : "Add set"}
            </Button>
          </div>
        </div>
      </form>

      <aside className="h-fit bg-card/55 p-5 sm:p-6 xl:sticky xl:top-24">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="font-mono text-[0.62rem] font-semibold tracking-[0.18em] text-primary uppercase">
              Session
            </p>
            <h3 className="mt-2 text-lg font-medium">Today&apos;s sets</h3>
          </div>
          <span className="rounded-full border border-border/70 px-2.5 py-1 text-[0.65rem] text-foreground-soft">
            {active?.sets.length ?? 0}{" "}
            {(active?.sets.length ?? 0) === 1 ? "set" : "sets"}
          </span>
        </div>

        <div className="mt-5 space-y-2.5">
          {active?.sets.length ? (
            active.sets.map((item, index) => (
              <div
                key={item.id}
                className="rounded-2xl border border-border/70 bg-background/45 p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[0.65rem] font-medium tracking-wide text-foreground-faint uppercase">
                      Set {index + 1}
                    </p>
                    <p className="mt-1 truncate text-sm font-medium">
                      {item.movement_name}
                    </p>
                  </div>
                  <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                    <Check className="size-3.5" />
                  </div>
                </div>
                <p className="mt-3 text-lg font-medium tracking-tight">
                  {item.reps
                    ? `${item.reps} reps`
                    : `${Number(item.hold_seconds)} sec`}
                </p>
                <p className="mt-2 text-[0.65rem] capitalize text-foreground-faint">
                  {item.source.replaceAll("_", " ")} ·{" "}
                  {item.intent.replaceAll("_", " ")}
                </p>
              </div>
            ))
          ) : (
            <div className="rounded-2xl border border-dashed border-border/80 px-4 py-8 text-center">
              <Dumbbell className="mx-auto size-5 text-foreground-faint" />
              <p className="mt-3 text-sm text-foreground-soft">
                Add your first set.
              </p>
              <p className="mt-1 text-xs text-foreground-faint">
                It will appear here as you train.
              </p>
            </div>
          )}
        </div>

        <div className="mt-6 border-t border-border/70 pt-5">
          <Label htmlFor="workout-notes">Session notes</Label>
          <Textarea
            id="workout-notes"
            className="mt-2 min-h-24 rounded-xl bg-background/60"
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            maxLength={2000}
            placeholder="Optional notes about today's session…"
          />
        </div>

        <Button
          className="mt-4 w-full"
          size="lg"
          variant="outline"
          onClick={complete}
          disabled={finish.isPending}
        >
          {finish.isPending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Check className="size-4" />
          )}
          {finish.isPending ? "Finishing…" : "Finish workout"}
        </Button>
      </aside>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <Label>{label}</Label>
        {hint ? (
          <span className="text-[0.68rem] text-foreground-faint">{hint}</span>
        ) : null}
      </div>
      {children}
    </div>
  );
}
