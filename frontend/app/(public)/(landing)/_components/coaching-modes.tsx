import Link from "next/link";
import {
  ArrowUpRight,
  Check,
  Clock3,
  LockKeyhole,
  Radio,
  Video,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const recordedFeatures = [
  "Upload a short calisthenics clip",
  "Movement and rep-phase analysis",
  "No account required",
  "Limited guest use",
];

const liveFeatures = [
  "Real-time movement detection",
  "Live rep counting",
  "Immediate technique feedback",
  "Connected workout history",
];

function FeatureList({
  features,
  inverse = false,
}: {
  features: string[];
  inverse?: boolean;
}) {
  return (
    <ul className="grid gap-3">
      {features.map((feature) => (
        <li
          key={feature}
          className={cn(
            "flex items-start gap-3 text-sm",
            inverse ? "text-visual-foreground/70" : "text-foreground-soft",
          )}
        >
          <span
            className={cn(
              "mt-0.5 grid size-5 shrink-0 place-items-center rounded-full",
              inverse
                ? "bg-visual-foreground/8 text-primary"
                : "bg-primary-light text-primary",
            )}
          >
            <Check className="size-3" aria-hidden="true" />
          </span>

          {feature}
        </li>
      ))}
    </ul>
  );
}

export function CoachingModes() {
  return (
    <section
      id="coaching-modes"
      className="scroll-mt-20 bg-background-alt"
      aria-labelledby="coaching-modes-title"
    >
      <div className="mx-auto w-full max-w-360 px-4 py-24 sm:px-5 sm:py-32 lg:py-40">
        <div className="grid gap-8 lg:grid-cols-[1fr_0.72fr] lg:items-end lg:gap-20">
          <div>
            <Badge variant="outline">Two coaching modes</Badge>

            <h2
              id="coaching-modes-title"
              className="mt-6 max-w-4xl text-[clamp(3rem,6vw,6rem)] leading-[0.93] font-medium tracking-[-0.065em] text-foreground"
            >
              Start with a clip. Build toward a live coach.
            </h2>
          </div>

          <p className="max-w-md text-base leading-7 text-foreground-soft lg:justify-self-end">
            Recorded analysis gives you focused feedback from a short clip. Live
            coaching is the next step: following movement as it happens and
            responding during the session.
          </p>
        </div>

        <div className="mt-16 grid gap-4 lg:mt-24 lg:grid-cols-2">
          {/* Recorded analysis */}
          <article className="flex min-h-155 flex-col border border-border bg-card p-6 sm:p-9 lg:p-11">
            <div className="flex items-start justify-between gap-6">
              <span className="grid size-12 place-items-center rounded-full border border-border text-primary">
                <Video className="size-5" aria-hidden="true" />
              </span>

              <Badge variant="secondary">Available to guests</Badge>
            </div>

            {/* Fixed-height intro keeps both dividers aligned */}
            <div className="mt-14 min-h-55 sm:min-h-60">
              <span className="font-mono text-[0.6rem] tracking-widest text-foreground-faint uppercase">
                Recorded / asynchronous
              </span>

              <h3 className="mt-3 text-[clamp(2.8rem,4.4vw,4.5rem)] leading-[0.95] font-medium tracking-[-0.06em] text-foreground">
                Analyze a video
              </h3>

              <p className="mt-5 max-w-xl text-sm leading-6 text-foreground-soft">
                Upload a short recorded movement and receive focused analysis of
                the movement, its phases, and supported technique signals.
              </p>
            </div>

            {/* Same feature-region height on both cards */}
            <div className="min-h-52.5 border-t border-border pt-8">
              <FeatureList features={recordedFeatures} />
            </div>

            <div className="mt-auto pt-10">
              <Link
                href="/analyze"
                className={buttonVariants({
                  variant: "brand",
                  size: "lg",
                })}
              >
                Analyze a video
                <ArrowUpRight className="size-4" aria-hidden="true" />
              </Link>
            </div>
          </article>

          {/* Live coach */}
          <article className="relative isolate flex min-h-155 flex-col overflow-hidden rounded-[2px_2px_40px_2px] border border-visual-foreground/12 bg-visual-surface dark:bg-background p-6 text-visual-foreground sm:p-9 lg:p-11">
            <div
              className="cv-grid absolute inset-0 -z-10 opacity-[0.07]"
              aria-hidden="true"
            />

            <div className="flex items-start justify-between gap-6">
              <span className="grid size-12 place-items-center rounded-full border border-visual-foreground/20 text-primary">
                <Radio className="size-5" aria-hidden="true" />
              </span>

              <Badge className="border-visual-foreground/15 bg-visual-foreground/8 text-visual-foreground">
                Planned live mode
              </Badge>
            </div>

            {/* Same height as recorded intro */}
            <div className="mt-14 min-h-55 sm:min-h-60">
              <span className="font-mono text-[0.6rem] tracking-widest text-visual-foreground/50 uppercase">
                Live / real time
              </span>

              <h3 className="mt-3 text-[clamp(3rem,5vw,5rem)] leading-[0.93] font-medium tracking-[-0.065em] text-visual-foreground">
                Live AI coach
              </h3>

              <p className="mt-5 max-w-xl text-sm leading-6 text-visual-foreground/70">
                The planned live experience will follow supported movements
                during training, track reps, and surface immediate technique
                feedback as the session progresses.
              </p>
            </div>

            {/* Divider now starts at exactly the same structural point */}
            <div className="min-h-52.5 border-t border-visual-foreground/15 pt-8">
              <div className="grid gap-8 md:grid-cols-[1fr_auto]">
                <FeatureList features={liveFeatures} inverse />

                <div className="flex items-center gap-2 self-end font-mono text-[0.58rem] tracking-[0.09em] text-visual-foreground/45 uppercase">
                  <Clock3 className="size-3.5" aria-hidden="true" />
                  Real-time response
                </div>
              </div>
            </div>

            <div className="mt-auto flex flex-wrap items-center gap-4 pt-10">
              <Link
                href="/login"
                className={cn(
                  buttonVariants({
                    size: "lg",
                  }),
                  "bg-visual-foreground text-visual-surface hover:bg-visual-foreground/90",
                )}
              >
                Sign in to Open Ascent
                <ArrowUpRight className="size-4" aria-hidden="true" />
              </Link>

              <span className="flex items-center gap-2 font-mono text-[0.58rem] tracking-[0.08em] text-visual-foreground/45 uppercase">
                <LockKeyhole className="size-3.5" aria-hidden="true" />
                Account required for live mode
              </span>
            </div>
          </article>
        </div>
      </div>
    </section>
  );
}
