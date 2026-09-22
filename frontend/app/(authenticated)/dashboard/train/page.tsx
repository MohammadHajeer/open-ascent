import Link from "next/link";
import { ArrowUpRight, Camera, ShieldCheck } from "lucide-react";

import { DashboardEmptyState } from "@/components/dashboard/dashboard-empty-state";
import { DashboardPageHeader } from "@/components/dashboard/dashboard-page-header";
import { DashboardSection } from "@/components/dashboard/dashboard-section";
import { ThemedAsset } from "@/components/shared/themed-asset";
import { buttonVariants } from "@/components/ui/button";
import { assets } from "@/lib/assets";
import { cn } from "@/lib/utils";

const analyzeAction = (
  <Link
    href="/analyze"
    className={cn(buttonVariants({ variant: "brand", size: "lg" }), "gap-2")}
  >
    Analyze movement
    <ArrowUpRight className="size-4" aria-hidden="true" />
  </Link>
);

export default function TrainPage() {
  return (
    <div className="space-y-8">
      <DashboardPageHeader
        eyebrow="Training workspace"
        title="Train with intention."
        description="Choose a focused training tool: live local coaching for pull-ups, or a deeper uploaded movement analysis."
      />

      <section className="relative overflow-hidden rounded-[1.6rem] border border-primary/20 bg-card/80 p-6 sm:p-8">
        <div
          className="cv-grid cv-grid-radial pointer-events-none absolute inset-0 opacity-[0.16]"
          aria-hidden="true"
        />
        <div className="relative grid gap-7 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
          <div className="max-w-2xl">
            <span className="inline-flex size-11 items-center justify-center rounded-2xl border border-primary/20 bg-primary-light text-primary">
              <Camera className="size-5" aria-hidden="true" />
            </span>
            <p className="mt-6 font-mono text-[0.56rem] font-semibold tracking-[0.14em] text-primary uppercase">
              Browser feasibility · Pull-Up
            </p>
            <h2 className="mt-2 text-3xl font-medium tracking-[-0.045em]">
              Live Coach
            </h2>
            <p className="mt-3 text-sm leading-6 text-foreground-soft">
              Camera-based pose inference runs locally in your browser. Get a
              deterministic rep count, phase, and one prioritized cue without
              uploading camera frames.
            </p>
            <p className="mt-4 flex items-center gap-2 text-xs text-foreground-faint">
              <ShieldCheck className="size-4 text-primary" />
              Explicit start · no recording · camera released on stop
            </p>
          </div>
          <Link
            href="/dashboard/train/live-coach"
            className={cn(buttonVariants({ variant: "brand", size: "lg" }), "gap-2")}
          >
            Open Live Coach
            <ArrowUpRight className="size-4" aria-hidden="true" />
          </Link>
        </div>
      </section>

      <DashboardSection
        eyebrow="Movement analysis"
        title="Review a recorded set in more detail."
        description="Upload a movement video for the existing asynchronous analyzer and saved analysis workflow."
      >
        <DashboardEmptyState
          title="No training sessions yet."
          description="There is no session data to show yet, so this space stays focused on what comes next."
          action={analyzeAction}
          visual={
            <ThemedAsset
              asset={assets.emptyStates.noTrainingPlan}
              alt=""
              width={176}
            />
          }
        />
      </DashboardSection>
    </div>
  );
}
