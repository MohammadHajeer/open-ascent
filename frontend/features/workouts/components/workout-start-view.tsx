import { Dumbbell, Loader2, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";

export function WorkoutStartView({ onStart, isPending }: { onStart: () => void; isPending: boolean }) {
  return (
    <section className="relative overflow-hidden bg-card/70 p-6 sm:p-7">
      <div className="pointer-events-none absolute -right-12 -top-16 size-52 rounded-full border border-primary/10" aria-hidden="true" />
      <div className="pointer-events-none absolute -right-2 top-10 size-28 rounded-full border border-primary/10" aria-hidden="true" />
      <div className="relative max-w-2xl">
        <span className="flex size-11 items-center justify-center rounded-2xl border border-primary/15 bg-primary/10 text-primary">
          <Dumbbell className="size-5" aria-hidden="true" />
        </span>
        <p className="mt-6 font-mono text-[0.62rem] font-semibold tracking-[0.18em] text-primary uppercase">
          New training session
        </p>
        <h2 className="mt-2 text-2xl font-medium tracking-tight sm:text-3xl">
          Log the work that actually happened.
        </h2>
        <p className="mt-3 max-w-xl text-sm leading-6 text-foreground-soft">
          Record repetitions or timed holds. Analysis and Live Coach evidence can be linked when it belongs to this workout.
        </p>
        <div className="mt-7 flex flex-wrap items-center gap-3">
          <Button type="button" size="lg" onClick={onStart} disabled={isPending}>
            {isPending ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
            {isPending ? "Starting…" : "Start workout"}
          </Button>
          <span className="text-xs text-foreground-faint">Reps · holds · training evidence</span>
        </div>
      </div>
    </section>
  );
}
