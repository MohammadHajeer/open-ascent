import Link from "next/link";
import { ArrowUpRight } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { AnalysisStage } from "./analysis-stage";
import { HeroEnvironment } from "./hero-environment";
import styles from "./hero.module.css";

const proof = [
  { value: "10+", label: "Calisthenics movements" },
  { value: "Phase-aware", label: "Rep-by-rep analysis" },
  { value: "Live", label: "Voice-cued coaching" },
] as const;

export function Hero() {
  return (
    <section id="hero" className={styles.hero} aria-labelledby="hero-title">
      <HeroEnvironment />

      <div className={styles.layout}>
        <div className={styles.copy}>
          <p className="flex items-center gap-2.5 font-mono text-[0.68rem] leading-none font-semibold tracking-widest text-primary uppercase">
            <span
              className="size-1.75 shrink-0 rounded-full bg-primary shadow-[0_0_0_5px_var(--primary-light)]"
              aria-hidden="true"
            />
            AI movement coaching
          </p>

          <h1
            id="hero-title"
            className="mt-6 text-[clamp(3rem,15.4vw,5rem)] leading-[0.92] font-semibold tracking-[-0.068em] text-foreground sm:mt-7 sm:text-[clamp(4.5rem,10.6vw,6.6rem)] lg:text-[clamp(4.4rem,6.3vw,7.3rem)]"
          >
            Calisthenics,
            <span className="block pb-[0.06em] font-[440] text-primary">
              understood.
            </span>
          </h1>

          <p className="mt-7 max-w-[30rem] text-[clamp(1rem,1.25vw,1.15rem)] leading-[1.7] text-foreground-soft sm:mt-8">
            An AI coach that sees how you move—tracking every rep, phase by
            phase, and turning it into clear cues. Upload a set or train live
            at the bar.
          </p>

          <div className="mt-9 flex flex-wrap items-center gap-x-3 gap-y-4 sm:mt-10">
            <Link
              href="/analyze"
              className={cn(
                buttonVariants({ variant: "brand", size: "lg" }),
                "h-11 gap-3 px-5 text-sm sm:px-6",
              )}
            >
              Analyze a video
              <ArrowUpRight className="size-4" aria-hidden="true" />
            </Link>

            <Link
              href="/login"
              aria-describedby="live-coach-note"
              className={cn(
                buttonVariants({ variant: "outline", size: "lg" }),
                "h-11 gap-3 px-5 text-sm sm:px-6",
              )}
            >
              Live coach
              <span
                className="size-1.75 rounded-full bg-primary shadow-[0_0_0_4px_var(--primary-light)]"
                aria-hidden="true"
              />
            </Link>

            <small
              id="live-coach-note"
              className="basis-full font-mono text-[0.6rem] tracking-[0.08em] text-foreground-faint uppercase sm:basis-auto sm:pl-1"
            >
              Live coach · sign in required
            </small>
          </div>
        </div>

        <div className={styles.visual}>
          <AnalysisStage />
        </div>

        <dl className={styles.proof} aria-label="What Open Ascent covers">
          {proof.map(({ value, label }) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
