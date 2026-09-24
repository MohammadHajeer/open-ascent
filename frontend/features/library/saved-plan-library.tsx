"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, ClipboardList, LoaderCircle } from "lucide-react";

import { DashboardEmptyState } from "@/components/dashboard/dashboard-empty-state";
import { DashboardPageHeader } from "@/components/dashboard/dashboard-page-header";
import { DashboardSection } from "@/components/dashboard/dashboard-section";
import { ThemedAsset } from "@/components/shared/themed-asset";
import { buttonVariants } from "@/components/ui/button";
import { assets } from "@/lib/assets";

import { listSavedPlans } from "./api";

const formatDate = (value: string) =>
  new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(value));

export function SavedPlanLibrary() {
  const plans = useQuery({ queryKey: ["library", "plans"], queryFn: listSavedPlans });
  const coachAction = <Link href="/dashboard/coach" className={buttonVariants({ variant: "brand" })}>Open AI Coach</Link>;

  return <div className="space-y-8">
    <DashboardPageHeader eyebrow="Your training plans" title="Library" description="Browse the weekly plans you chose to save from AI Coach." action={coachAction} />
    <DashboardSection eyebrow="Saved work" title="Weekly plans" description="Plans stay here after you save a Coach preview. Open one to review its days and prescriptions.">
      {plans.isPending ? <div role="status" className="flex min-h-48 items-center justify-center gap-2 text-sm text-foreground-soft"><LoaderCircle className="size-4 animate-spin" aria-hidden="true" />Loading your plans…</div>
        : plans.isError ? <DashboardEmptyState icon={<ClipboardList className="size-5" />} title="Your plans could not be loaded." description="Check your connection and try again." action={<button type="button" onClick={() => void plans.refetch()} className={buttonVariants({ variant: "outline" })}>Try again</button>} />
          : plans.data.length === 0 ? <DashboardEmptyState visual={<ThemedAsset asset={assets.emptyStates.noTrainingPlan} alt="" width={176} />} title="No saved plans yet." description="Generate a weekly plan with AI Coach, review the preview, and save it when it fits your training." action={coachAction} />
            : <div className="grid gap-4 p-5 sm:p-7 lg:grid-cols-2">
              {plans.data.map((plan) => <article key={plan.id} className="flex min-w-0 flex-col rounded-2xl border border-border/80 bg-background/50 p-5 sm:p-6">
                <p className="font-mono text-[0.58rem] font-semibold uppercase tracking-[0.12em] text-primary">Saved {formatDate(plan.saved_at)}</p>
                <h3 className="mt-2 text-xl font-medium tracking-[-0.035em] text-foreground">{plan.title}</h3>
                {plan.summary && <p className="mt-2 text-sm leading-6 text-foreground-soft">{plan.summary}</p>}
                <p className="mt-4 text-xs text-foreground-faint">{plan.training_day_count} training {plan.training_day_count === 1 ? "day" : "days"} · {plan.movement_count} {plan.movement_count === 1 ? "movement" : "movements"}</p>
                <Link href={`/dashboard/library/${plan.id}`} className={`${buttonVariants({ variant: "outline" })} mt-5 w-full gap-2 sm:ml-auto sm:w-auto`} aria-label={`Open ${plan.title}`}>Open plan <ArrowUpRight className="size-4" aria-hidden="true" /></Link>
              </article>)}
            </div>}
    </DashboardSection>
  </div>;
}
