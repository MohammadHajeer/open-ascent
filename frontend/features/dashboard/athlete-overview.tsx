"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Activity, ArrowUpRight, Camera, ClipboardList, Dumbbell, MessageCircle, ScanLine } from "lucide-react";

import { DashboardPageHeader } from "@/components/dashboard/dashboard-page-header";
import { DashboardSection } from "@/components/dashboard/dashboard-section";
import { ThemedAsset } from "@/components/shared/themed-asset";
import { buttonVariants } from "@/components/ui/button";
import { useAnalysisHistory } from "@/features/analysis/hooks";
import { useProgressSummary } from "@/features/progress/hooks";
import { comparableMetric } from "@/features/progress/presentation";
import { useWorkoutSessions } from "@/features/workouts/hooks";
import { assets } from "@/lib/assets";
import { cn } from "@/lib/utils";

import { fetchDashboardContext } from "./api";

const dateFormatter = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });
const goals: Record<string, string> = { strength: "Build strength", skill: "Develop a skill", technique: "Improve technique", consistency: "Train consistently" };
const date = (value: string) => dateFormatter.format(new Date(value));

function Action({ href, children, primary = false }: { href: string; children: React.ReactNode; primary?: boolean }) {
  return <Link href={href} className={cn(buttonVariants({ variant: primary ? "brand" : "outline" }), "gap-2")}>
    {children}<ArrowUpRight className="size-4" aria-hidden="true" />
  </Link>;
}

function Message({ text, href, action, visual }: { text: string; href?: string; action?: string; visual?: React.ReactNode }) {
  return <div className="flex min-h-40 flex-col items-start justify-center gap-4 px-5 py-7 sm:px-7">
    {visual}
    <p className="max-w-md text-sm leading-6 text-foreground-soft">{text}</p>{href && action && <Action href={href}>{action}</Action>}
  </div>;
}

export function AthleteOverview() {
  const context = useQuery({ queryKey: ["dashboard", "context"], queryFn: fetchDashboardContext });
  const workouts = useWorkoutSessions();
  const progress = useProgressSummary();
  const analyses = useAnalysisHistory(5);
  const active = workouts.data?.find((session) => !session.completed_at);
  const recent = workouts.data?.filter((session) => session.completed_at).slice(0, 3);
  const analysis = analyses.data?.[0];
  const evidence = progress.data?.movements
    .map((movement) => ({ movement, metric: comparableMetric(movement) }))
    .filter((item) => item.metric?.points.length)
    .toSorted((a, b) => (b.metric?.points.at(-1)?.recorded_at ?? "").localeCompare(a.metric?.points.at(-1)?.recorded_at ?? ""))[0];
  const point = evidence?.metric?.points.at(-1);
  const previousPoint = evidence?.metric?.points.at(-2);
  const plan = context.data?.latest_plan;
  const firstName = context.data?.display_name?.trim().split(/\s+/)[0];

  return <div className="space-y-6 sm:space-y-8">
    <DashboardPageHeader eyebrow="Training overview" title={firstName ? `Your day, ${firstName}.` : "Your training, today."}
      description={context.data?.primary_goal
        ? `${goals[context.data.primary_goal] ?? "Your training goal"}${context.data.days_per_week ? ` · ${context.data.days_per_week} days a week` : ""}. Your recent work and next steps are below.`
        : "Pick up where you left off and see the evidence from your training."} />

    <section data-tour="dashboard-overview" className="grid gap-4 lg:grid-cols-[minmax(0,1.45fr)_minmax(280px,0.8fr)]">
      <div className="relative overflow-hidden rounded-[1.6rem] border border-primary/20 bg-card/80 p-6 sm:p-8">
        <div className="cv-grid cv-grid-radial pointer-events-none absolute inset-0 opacity-[0.16]" aria-hidden="true" />
        <div className="relative">
          <span className="inline-flex size-11 items-center justify-center rounded-2xl border border-primary/20 bg-primary-light text-primary"><Dumbbell className="size-5" aria-hidden="true" /></span>
          <p className="mt-6 font-mono text-[0.58rem] font-semibold tracking-[0.14em] text-primary uppercase">Next action</p>
          <h2 className="mt-2 text-2xl font-medium tracking-[-0.04em] sm:text-3xl">{active ? "Finish the workout you started." : plan ? "Use your saved weekly plan." : workouts.isPending || context.isPending ? "Gathering your training context." : workouts.isError || context.isError ? "Choose a training tool." : "Start with a training session."}</h2>
          <p className="mt-3 max-w-xl text-sm leading-6 text-foreground-soft">{active
            ? `${active.set_count} ${active.set_count === 1 ? "set" : "sets"} logged so far. Resume it in Train.`
            : plan ? `${plan.title} is saved below. Review a day, then log what you actually train.`
              : workouts.isPending || context.isPending ? "Your recent sessions and saved plan are loading."
                : workouts.isError || context.isError ? "You can still log a workout, analyze a movement, or open AI Coach."
              : "Log a workout to build a record you can use to track progress and guide coaching."}</p>
          <div className="mt-6 flex flex-wrap gap-2"><Action href={plan && !active ? `/dashboard/library/${plan.id}` : "/dashboard/train"} primary>{active ? "Resume workout" : plan ? "View plan" : "Log workout"}</Action><Action href="/analyze">Analyze movement</Action></div>
        </div>
      </div>
      <div className="rounded-[1.6rem] border border-border bg-background-alt/65 p-6 sm:p-7">
        <p className="font-mono text-[0.58rem] font-semibold tracking-[0.14em] text-primary uppercase">Quick actions</p>
        <div className="mt-5 grid gap-2">{[
          { href: "/dashboard/train", label: "Log a workout", icon: Dumbbell },
          { href: "/dashboard/train/live-coach", label: "Open Live Coach", icon: Camera },
          { href: "/dashboard/coach", label: "Ask AI Coach", icon: MessageCircle },
        ].map(({ href, label, icon: Icon }) => <Link key={href} href={href} className="flex items-center justify-between rounded-xl border border-border/75 bg-card/65 px-4 py-3 text-sm font-medium transition-colors hover:border-primary/40 hover:text-primary">
          <span className="flex items-center gap-3"><Icon className="size-4 text-primary" aria-hidden="true" />{label}</span><ArrowUpRight className="size-4 text-foreground-faint" aria-hidden="true" />
        </Link>)}</div>
      </div>
    </section>

    <div className="grid gap-4 xl:grid-cols-2">
      <div id="weekly-plan" className="scroll-mt-24"><DashboardSection eyebrow="Weekly plan" title="Your saved plan" aside={<ClipboardList className="size-5 text-foreground-faint" aria-hidden="true" />}>
        {context.isPending ? <Message text="Loading your plan…" />
          : context.isError ? <Message text="Your plan could not be loaded right now." href="/dashboard/coach" action="Open AI Coach" />
            : plan ? <div className="px-5 py-6 sm:px-7">
              <h3 className="text-lg font-medium tracking-[-0.025em]">{plan.title}</h3>
              {plan.summary && <p className="mt-1 text-sm leading-6 text-foreground-soft">{plan.summary}</p>}
              <p className="mt-2 text-xs text-foreground-faint">Saved {date(plan.saved_at)} · {plan.days.length} training {plan.days.length === 1 ? "day" : "days"}</p>
              <div className="mt-5 grid gap-2">{plan.days.map((day) => <div key={day.day_index} className="rounded-xl border border-border/75 bg-background/45 px-4 py-3">
                <p className="text-sm font-medium">Day {day.day_index}{day.label ? ` · ${day.label}` : ""}</p>
                <p className="mt-1 text-xs leading-5 text-foreground-soft">{day.exercises.map((exercise) => `${exercise.movement_name} (${exercise.sets} × ${exercise.reps === null ? `${exercise.hold_seconds}s` : `${exercise.reps} reps`})`).join(" · ")}</p>
              </div>)}</div>
              <p className="mt-4 text-xs text-foreground-faint">Plan days are a sequence, not scheduled dates. Check current movement guidance before training.</p>
              <div className="mt-4"><Action href={`/dashboard/library/${plan.id}`}>Open in Library</Action></div>
            </div> : <div className="px-5 py-7 sm:px-7">
              <ThemedAsset asset={assets.emptyStates.noTrainingPlan} alt="" width={120} />
              <p className="mt-3 text-sm font-medium">No weekly plan saved yet.</p>
              <p className="mt-1 max-w-sm text-sm leading-6 text-foreground-soft">Ask AI Coach for a plan, then review and save it when it fits your training.</p>
              <div className="mt-4"><Action href="/dashboard/coach">Create a plan</Action></div>
            </div>}
      </DashboardSection></div>
      <DashboardSection eyebrow="Training record" title="Recent workouts" aside={<Dumbbell className="size-5 text-foreground-faint" aria-hidden="true" />}>
        {workouts.isPending ? <Message text="Loading your workouts…" />
          : workouts.isError ? <Message text="Your workouts could not be loaded right now." href="/dashboard/train" action="Open Train" />
            : recent?.length ? <div className="divide-y divide-border/75">{recent.map((session) => <div key={session.id} className="flex items-center justify-between gap-4 px-5 py-4 sm:px-7">
              <div><p className="text-sm font-medium">Workout · {date(session.started_at)}</p><p className="mt-1 text-xs text-foreground-soft">{session.set_count} {session.set_count === 1 ? "set" : "sets"} logged</p></div>
              <Activity className="size-4 text-primary" aria-hidden="true" />
            </div>)}<div className="px-5 py-4 sm:px-7"><Action href="/dashboard/train">Open training log</Action></div></div>
              : <Message text="No completed workouts yet. Log a session to start your training record." href="/dashboard/train" action="Log a workout" visual={<ThemedAsset asset={assets.emptyStates.noWorkouts} alt="" width={120} />} />}
      </DashboardSection>
    </div>

    <div className="grid gap-4 xl:grid-cols-2">
      <DashboardSection eyebrow="Training evidence" title="Progress this week" aside={<Activity className="size-5 text-foreground-faint" aria-hidden="true" />}>
        {progress.isPending ? <Message text="Loading your progress…" />
          : progress.isError ? <Message text="Your progress could not be loaded right now." href="/dashboard/progress" action="Open Progress" />
            : progress.data ? <div className="px-5 py-6 sm:px-7">
              <div className="grid grid-cols-3 gap-2">{[
                ["Workouts", progress.data.consistency.workouts_this_week],
                ["Active days", progress.data.consistency.active_days_this_week],
                ["Sets", progress.data.consistency.sets_this_week],
              ].map(([label, value]) => <div key={label} className="rounded-xl border border-border/75 bg-background/45 p-3"><p className="text-2xl font-medium tabular-nums">{value}</p><p className="mt-1 text-xs text-foreground-soft">{label}</p></div>)}</div>
              <p className="mt-3 text-xs text-foreground-faint">This week, from sets attributed to you.</p>
              {point && evidence?.metric ? <p className="mt-5 text-sm leading-6 text-foreground-soft">
                {previousPoint ? "Recent logged values" : "Latest logged"}: <span className="font-medium text-foreground">{evidence.movement.name} · {previousPoint ? `${previousPoint.value} → ` : ""}{point.value} {evidence.metric.unit}</span>{previousPoint ? ` (${date(previousPoint.recorded_at)} to ${date(point.recorded_at)})` : ` on ${date(point.recorded_at)}`}.
              </p>
                : <p className="mt-5 text-sm leading-6 text-foreground-soft">Log a self-performed set to start tracking movement progress.</p>}
              <div className="mt-4"><Action href={point ? "/dashboard/progress" : "/dashboard/train"}>{point ? "Explore progress" : "Log a workout"}</Action></div>
            </div> : null}
      </DashboardSection>
      <DashboardSection eyebrow="Movement review" title="Latest analysis" aside={<ScanLine className="size-5 text-foreground-faint" aria-hidden="true" />}>
        {analyses.isPending ? <Message text="Loading your analyses…" />
          : analyses.isError ? <Message text="Your analyses could not be loaded right now." href="/dashboard/analyses" action="Open analyses" />
            : analysis ? <div className="px-5 py-6 sm:px-7">
              <p className="text-lg font-medium">{analysis.movement.name}</p>
              <p className="mt-1 text-xs text-foreground-faint">{date(analysis.created_at)} · {analysis.status.replaceAll("_", " ")}</p>
              {analysis.status === "completed" && analysis.valid_rep_count !== null && analysis.partial_rep_count !== null && analysis.uncertain_rep_count !== null ? <p className="mt-4 text-sm leading-6 text-foreground-soft">{analysis.valid_rep_count} valid · {analysis.partial_rep_count} partial · {analysis.uncertain_rep_count} uncertain reps</p>
                : <p className="mt-4 text-sm leading-6 text-foreground-soft">{analysis.status === "completed" ? "Rep counts are unavailable for this result." : analysis.stage.replaceAll("_", " ")}</p>}
              <div className="mt-5"><Action href={analysis.status === "completed" ? `/dashboard/analyses/${analysis.analysis_id}` : "/dashboard/analyses"}>{analysis.status === "completed" ? "Review result" : "View analysis history"}</Action></div>
            </div> : <Message text="No saved analyses yet. Analyze a movement to get a detailed review." href="/analyze" action="Analyze movement" />}
      </DashboardSection>
    </div>
  </div>;
}
