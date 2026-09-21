import Link from "next/link";
import { ArrowUpRight, Check, ShieldCheck } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const freeFeatures = [
  "Persistent authenticated analysis history",
  "Basic progress tracking",
  "Limited uploaded video analyses",
  "Limited AI Coach usage as it becomes available",
  "Movement library and documentation",
  "Training plan capability within plan limits",
];

const proFeatures = [
  "Higher uploaded-analysis allowance",
  "Higher AI Coach allowance",
  "Live Coach",
  "Adaptive training plans",
  "Advanced progress insights",
];

function PlanList({ features }: { features: string[] }) {
  return (
    <ul className="grid gap-3 border-t border-current/10 pt-7">
      {features.map((feature) => (
        <li className="flex items-start gap-3 text-sm leading-6" key={feature}>
          <span className="mt-1 grid size-5 shrink-0 place-items-center rounded-full bg-primary-light text-primary">
            <Check className="size-3" aria-hidden="true" />
          </span>
          {feature}
        </li>
      ))}
    </ul>
  );
}

export function Plans() {
  return (
    <section className="bg-background" aria-labelledby="plans-title">
      <div className="mx-auto w-full max-w-360 px-4 py-24 sm:px-5 sm:py-32 lg:py-40">
        <div className="grid gap-8 lg:grid-cols-[1fr_0.72fr] lg:items-end lg:gap-20">
          <div>
            <Badge variant="outline">Free vs Pro</Badge>
            <h2
              id="plans-title"
              className="mt-6 max-w-4xl text-[clamp(3rem,6vw,6rem)] leading-[0.93] font-medium tracking-[-0.065em] text-foreground"
            >
              Keep the record. Deepen the coaching.
            </h2>
          </div>
          <p className="max-w-md text-base leading-7 text-foreground-soft lg:justify-self-end">
            A free account adds continuity to every session. Pro is for athletes
            who want more analysis capacity and advanced coaching tools.
          </p>
        </div>

        <div className="mt-16 grid gap-4 lg:mt-24 lg:grid-cols-2">
          <article className="flex min-h-145 flex-col border border-border bg-card p-6 sm:p-9 lg:p-11">
            <div className="flex items-center justify-between gap-4">
              <span className="font-mono text-[0.6rem] tracking-widest text-foreground-faint uppercase">
                Authenticated plan
              </span>
              <Badge variant="secondary">Free</Badge>
            </div>
            <h3 className="mt-12 text-[clamp(3rem,5vw,5rem)] leading-[0.93] font-medium tracking-[-0.065em]">
              Free
            </h3>
            <p className="mt-5 mb-10 max-w-lg text-sm leading-6 text-foreground-soft">
              A persistent training record and the core tools to understand your
              movement over time.
            </p>
            <PlanList features={freeFeatures} />
            <Link
              href="/signup"
              className={cn(buttonVariants({ variant: "outline", size: "lg" }), "mt-auto self-start")}
            >
              Create a free account
              <ArrowUpRight aria-hidden="true" />
            </Link>
          </article>

          <article className="relative isolate flex min-h-145 flex-col overflow-hidden rounded-[2px_2px_40px_2px] border border-visual-foreground/12 bg-visual-surface p-6 text-visual-foreground dark:bg-background sm:p-9 lg:p-11">
            <div className="cv-grid absolute inset-0 -z-10 opacity-[0.07]" aria-hidden="true" />
            <div className="flex items-center justify-between gap-4">
              <span className="font-mono text-[0.6rem] tracking-widest text-visual-foreground/50 uppercase">
                Advanced coaching
              </span>
              <Badge className="border-visual-foreground/15 bg-visual-foreground/8 text-visual-foreground">
                Pro
              </Badge>
            </div>
            <h3 className="mt-12 text-[clamp(3rem,5vw,5rem)] leading-[0.93] font-medium tracking-[-0.065em]">
              Pro
            </h3>
            <p className="mt-5 mb-10 max-w-lg text-sm leading-6 text-visual-foreground/70">
              Advanced coaching and progression for a more responsive training
              practice.
            </p>
            <PlanList features={proFeatures} />
            <Link
              href="/dashboard/settings"
              className="mt-auto inline-flex h-9 w-fit items-center gap-1.5 rounded-lg bg-visual-foreground px-2.5 text-sm font-medium text-visual-surface transition-transform hover:-translate-y-0.5"
            >
              Explore Pro in settings
              <ArrowUpRight aria-hidden="true" />
            </Link>
          </article>
        </div>

        <div className="mt-5 flex items-start gap-3 border border-border bg-background-alt px-5 py-4 text-sm leading-6 text-foreground-soft sm:px-7">
          <ShieldCheck className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden="true" />
          <p>
            Safety guidance—including cautions, prerequisites, stop conditions,
            and safer progressions—is included with both Free and Pro.
          </p>
        </div>
      </div>
    </section>
  );
}

