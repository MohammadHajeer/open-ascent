"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, LoaderCircle } from "lucide-react";

import { DashboardEmptyState } from "@/components/dashboard/dashboard-empty-state";
import { DashboardPageHeader } from "@/components/dashboard/dashboard-page-header";
import { DashboardSection } from "@/components/dashboard/dashboard-section";
import { buttonVariants } from "@/components/ui/button";
import { ApiError } from "@/lib/api";

import { getSavedPlan, type SavedPlanExercise } from "./api";

export function Prescription({ exercise }: { exercise: SavedPlanExercise }) {
  const target = exercise.reps !== null ? `${exercise.reps} reps` : `${exercise.hold_seconds} sec hold`;
  return `${exercise.sets} sets × ${target} · ${exercise.rest_seconds} sec rest`;
}

export function SavedPlanDetail({ planId }: { planId: string }) {
  const plan = useQuery({ queryKey: ["library", "plan", planId], queryFn: () => getSavedPlan(planId) });
  const back = <Link href="/dashboard/library" className={`${buttonVariants({ variant: "outline" })} gap-2`}><ArrowLeft className="size-4" aria-hidden="true" />All saved plans</Link>;

  if (plan.isPending) return <div className="space-y-8"><DashboardPageHeader eyebrow="Library" title="Saved plan" action={back} /><div role="status" className="flex min-h-48 items-center justify-center gap-2 text-sm text-foreground-soft"><LoaderCircle className="size-4 animate-spin" aria-hidden="true" />Loading plan…</div></div>;
  if (plan.isError) {
    const missing = plan.error instanceof ApiError && [404, 422].includes(plan.error.status);
    return <div className="space-y-8">
      <DashboardPageHeader eyebrow="Library" title="Saved plan" action={back} />
      <DashboardEmptyState
        title={missing ? "Plan not found." : "This plan could not be loaded."}
        description={missing ? "This saved plan is unavailable for this account." : "Check your connection and try again."}
        action={missing ? undefined : <button type="button" onClick={() => void plan.refetch()} className={buttonVariants({ variant: "outline" })}>Try again</button>}
      />
    </div>;
  }

  const value = plan.data;
  const savedDate = new Intl.DateTimeFormat(undefined, { dateStyle: "long" }).format(new Date(value.saved_at));
  return <div className="space-y-8">
    <DashboardPageHeader eyebrow="Library / Saved plan" title={value.title} description={value.summary ?? "Review the days and exercises in this saved weekly plan."} action={back} />
    {value.origin && <p className="text-xs text-foreground-soft">{value.origin.mode === "profile" ? "Started from profile" : value.origin.mode === "goal" ? `Goal: ${value.origin.goal_name}` : "Adapted to progress"} · Based on {value.origin.based_on.join(", ")}</p>}
    {value.provisional_readiness && <p className="text-xs text-foreground-soft">This plan was based partly on structured self-reported readiness at the time it was saved.</p>}
    <p className="text-sm text-foreground-soft">Saved {savedDate} · {value.training_day_count} training {value.training_day_count === 1 ? "day" : "days"} · {value.movement_count} {value.movement_count === 1 ? "movement" : "movements"}</p>
    <div className="grid gap-4 xl:grid-cols-2">
      {value.days.map((day) => <DashboardSection key={day.day_index} eyebrow={`Day ${day.day_index}`} title={day.label ?? `Training day ${day.day_index}`}>
        <ol className="divide-y divide-border/75 px-5 sm:px-7">
          {day.exercises.map((exercise, index) => <li key={`${exercise.movement_id}-${index}`} className="py-5">
            <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
              <p className="text-sm font-medium text-foreground">{exercise.movement_slug ? <Link href={`/movements/${exercise.movement_slug}`} className="underline decoration-border underline-offset-4 hover:text-primary">{exercise.movement_name}</Link> : exercise.movement_name}</p>
              <p className="text-sm text-foreground-soft sm:text-right"><Prescription exercise={exercise} /></p>
            </div>
            {exercise.notes && <p className="mt-2 text-xs leading-5 text-foreground-faint">{exercise.notes}</p>}
          </li>)}
        </ol>
      </DashboardSection>)}
    </div>
    <p className="text-xs leading-5 text-foreground-faint">Days are a sequence, not scheduled dates. Review each movement’s current safety guide before training.</p>
  </div>;
}
