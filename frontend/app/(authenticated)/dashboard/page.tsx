import Link from "next/link";
import { ArrowUpRight, Clock3, ScanLine } from "lucide-react";

import { DashboardPageHeader } from "@/components/dashboard/dashboard-page-header";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export default function DashboardPage() {
  return (
    <div className="space-y-8">
      <DashboardPageHeader
        eyebrow="Training overview"
        title="Your movement, over time."
        description="This workspace will become the home for your saved analyses, movement history, and training context."
      />

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.55fr)_minmax(280px,0.65fr)]">
        <div className="relative overflow-hidden rounded-[1.6rem] border border-border bg-card/80 p-6 sm:p-8 lg:p-10">
          <div
            className="cv-grid cv-grid-radial pointer-events-none absolute inset-0 opacity-[0.18]"
            aria-hidden="true"
          />

          <div className="relative max-w-2xl">
            <span className="inline-flex size-11 items-center justify-center rounded-2xl border border-primary/20 bg-primary-light text-primary">
              <ScanLine className="size-5" aria-hidden="true" />
            </span>

            <h2 className="mt-8 max-w-xl text-3xl leading-[0.98] font-medium tracking-[-0.045em] sm:text-4xl">
              Start building your movement record.
            </h2>

            <p className="mt-4 max-w-xl text-sm leading-6 text-foreground-soft">
              Run an analysis and, once authenticated history is connected,
              your completed sessions will appear here without making this
              server page fetch private data.
            </p>

            <Link
              href="/analyze"
              className={cn(
                buttonVariants({ variant: "brand" }),
                "mt-7 inline-flex gap-2",
              )}
            >
              Analyze movement
              <ArrowUpRight className="size-4" aria-hidden="true" />
            </Link>
          </div>
        </div>

        <div className="rounded-[1.6rem] border border-border bg-background-alt/65 p-6 sm:p-7">
          <span className="font-mono text-[0.56rem] font-semibold tracking-[0.13em] text-primary uppercase">
            Workspace
          </span>

          <h2 className="mt-3 text-xl font-medium tracking-[-0.035em]">
            Ready for private data.
          </h2>

          <p className="mt-3 text-sm leading-6 text-foreground-soft">
            The shell is intentionally data-light. TanStack Query client
            islands can plug into these surfaces next.
          </p>

          <div className="mt-7 space-y-3 border-t border-border pt-5">
            {[
              "Saved movement analyses",
              "Training history",
              "Profile-aware insights",
            ].map((item) => (
              <div
                key={item}
                className="flex items-center gap-3 text-sm text-foreground-mid"
              >
                <span className="size-1.5 rounded-full bg-primary" />
                {item}
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="rounded-[1.6rem] border border-border bg-card/60">
        <div className="flex items-center justify-between gap-4 border-b border-border px-5 py-4 sm:px-6">
          <div>
            <span className="font-mono text-[0.55rem] font-semibold tracking-[0.12em] text-primary uppercase">
              Recent analyses
            </span>
            <h2 className="mt-1 text-base font-medium">Movement history</h2>
          </div>

          <Clock3 className="size-4 text-foreground-faint" aria-hidden="true" />
        </div>

        <div className="grid min-h-40 place-items-center px-6 py-10 text-center">
          <div>
            <p className="text-sm font-medium text-foreground">
              No dashboard data connected yet.
            </p>
            <p className="mt-1 text-xs leading-5 text-foreground-soft">
              This area is ready for the authenticated analyses query.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
