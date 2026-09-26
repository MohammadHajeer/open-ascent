import Link from "next/link";
import { Suspense } from "react";
import { ArrowUpRight, Check, ShieldCheck } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { FREE_COACH_DAILY_MESSAGES } from "@/features/subscription/presentation";
import { publicApiFetch } from "@/lib/public-api";

const freeFeatures = [
  "Persistent authenticated analysis history",
  "Basic progress tracking",
  "Limited uploaded video analyses",
  "One weekly plan generation each month",
  `AI Coach with ${FREE_COACH_DAILY_MESSAGES} messages a day`,
  "Movement library and documentation",
  "Training plan capability within plan limits",
];

const proFeatures = [
  "Higher uploaded-analysis allowance",
  "Full AI Coach access",
  "Live Coach",
  "Adaptive training plans",
  "Advanced progress insights",
];

function PlanList({ features }: { features: string[] }) {
  return (
    <ul className="grid gap-3 border-t border-current/10 pt-8">
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

async function ProPrice() {
  let display: string | null = null;
  try {
    const price = await publicApiFetch<{ unit_amount: number; currency: string; interval: string }>(
      "/subscriptions/pro-price",
    );
    const amount = new Intl.NumberFormat("en-US", { style: "currency", currency: price.currency }).format(price.unit_amount / 100);
    display = `${amount} / ${price.interval}`;
  } catch {
    // Keep the plan comparison available if the billing provider is offline.
  }
  return <p className="mt-3 text-base font-medium">{display ?? "See current price in Settings"}</p>;
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

        <div className="mt-16 grid items-stretch gap-4 lg:mt-24 lg:grid-cols-2">
          <article className="flex h-full min-h-145 flex-col border border-border bg-card p-6 sm:p-9 lg:p-11">
            <div className="flex items-center justify-between gap-4">
              <span className="font-mono text-[0.6rem] tracking-widest text-foreground-faint uppercase">
                Authenticated plan
              </span>
              <Badge variant="secondary">Free</Badge>
            </div>
            <div className="mt-12 min-h-44">
              <h3 className="text-[clamp(3rem,5vw,5rem)] leading-[0.93] font-medium tracking-[-0.065em]">
                Free
              </h3>
              <p className="mt-5 max-w-lg text-sm leading-6 text-foreground-soft">
                A persistent training record and the core tools to understand your
                movement over time.
              </p>
            </div>
            <PlanList features={freeFeatures} />
            <div className="mt-auto pt-12">
              <Link
                href="/signup"
                className={cn(
                  buttonVariants({ variant: "outline", size: "lg" }),
                  "self-start",
                )}
              >
                Create a free account
                <ArrowUpRight aria-hidden="true" />
              </Link>
            </div>
          </article>

          <article className="relative isolate flex h-full min-h-145 flex-col overflow-hidden rounded-[2px_2px_40px_2px] border border-visual-foreground/12 bg-visual-surface p-6 text-visual-foreground dark:bg-background sm:p-9 lg:p-11">
            <div className="cv-grid absolute inset-0 -z-10 opacity-[0.07]" aria-hidden="true" />
            <div className="flex items-center justify-between gap-4">
              <span className="font-mono text-[0.6rem] tracking-widest text-visual-foreground/50 uppercase">
                Advanced coaching
              </span>
              <Badge className="border-visual-foreground/15 bg-visual-foreground/8 text-visual-foreground">
                Pro
              </Badge>
            </div>
            <div className="mt-12 min-h-44">
              <h3 className="text-[clamp(3rem,5vw,5rem)] leading-[0.93] font-medium tracking-[-0.065em]">
                Pro
              </h3>
              <Suspense fallback={<p className="mt-3 text-sm text-visual-foreground/70">Checking monthly price…</p>}>
                <ProPrice />
              </Suspense>
              <p className="mt-5 max-w-lg text-sm leading-6 text-visual-foreground/70">
                Advanced coaching and progression for a more responsive training
                practice.
              </p>
            </div>
            <PlanList features={proFeatures} />
            <div className="mt-auto pt-12">
              <Link
                href="/dashboard/settings"
                className="inline-flex h-9 w-fit items-center gap-1.5 rounded-lg bg-visual-foreground px-2.5 text-sm font-medium text-visual-surface transition-transform hover:-translate-y-0.5"
              >
                Explore Pro in settings
                <ArrowUpRight aria-hidden="true" />
              </Link>
            </div>
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
