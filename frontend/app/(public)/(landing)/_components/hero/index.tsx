import Link from "next/link";
import { ArrowUpRight } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { HeroEnvironment } from "./hero-environment";
import {
  MovementIntelligence,
  PhaseTimeline,
  TechniqueFeedback,
} from "./movement-intelligence";
import styles from "./hero.module.css";

export function Hero() {
  return (
    <section id="hero" className={styles.hero} aria-labelledby="hero-title">
      <HeroEnvironment />

      <div className={styles.canvas}>
        <div className={styles.copy}>
          <div className="flex max-w-70 items-center gap-2.5 font-mono text-[0.67rem] leading-snug font-semibold tracking-widest text-primary uppercase sm:max-w-none">
            <span
              className="size-1.75 shrink-0 rounded-full bg-primary shadow-[0_0_0_5px_var(--primary-light)]"
              aria-hidden="true"
            />
            Movement intelligence for calisthenics
          </div>

          <h1
            id="hero-title"
            className="mt-5 max-w-190 text-[clamp(3.1rem,15.5vw,5.2rem)] leading-[0.94] font-semibold tracking-[-0.075em] text-foreground sm:mt-6 sm:text-[clamp(4.2rem,13vw,6.8rem)] lg:text-[clamp(4rem,7.2vw,6.2rem)] xl:text-[clamp(4.2rem,7vw,7rem)]"
          >
            Your form.
            <span className={`${styles.understood} font-[460] text-primary`}>
              Understood.
            </span>
          </h1>

          <p className="mt-7 max-w-md text-[clamp(1rem,1.3vw,1.19rem)] leading-7 text-foreground-soft sm:mt-8 sm:leading-[1.72]">
            A coach that sees the movement—not just the workout. Analyze your
            technique, understand each phase, and move with more control.
          </p>

          <div className="mt-9 grid grid-cols-2 items-start gap-2.5 sm:flex sm:gap-3.5">
            <Link
              href="/analyze"
              className={cn(
                buttonVariants({
                  variant: "brand",
                  size: "lg",
                }),
                "gap-2 px-4 text-xs sm:gap-4 sm:px-6 sm:text-sm",
              )}
            >
              Analyze a video
              <ArrowUpRight className="size-4" aria-hidden="true" />
            </Link>

            <div className="grid justify-items-center gap-2">
              <Link
                href="/login"
                aria-describedby="live-coach-note"
                className={cn(
                  buttonVariants({
                    variant: "outline",
                    size: "lg",
                  }),
                  "w-full gap-2 px-4 text-xs sm:gap-4 sm:px-6 sm:text-sm",
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
                className="font-mono text-[0.58rem] tracking-[0.06em] text-foreground-soft uppercase"
              >
                Sign in required
              </small>
            </div>
          </div>
        </div>

        <MovementIntelligence />
      </div>

      <div className={styles.footer}>
        <PhaseTimeline />

        <div className={styles.rail}>
          <dl className={styles.capabilities} aria-label="Product capabilities">
            <div>
              <dt>Calisthenics movements</dt>

              <dd>
                10
                <span className={styles.capabilityAccent}>+</span>
              </dd>
            </div>

            <div>
              <dt>Movement analysis</dt>

              <dd>
                <span className={styles.phaseMark} aria-hidden="true">
                  <i />
                  <i />
                  <i />
                  <i />
                </span>
                Phase-aware
              </dd>
            </div>
          </dl>

          <TechniqueFeedback />
        </div>
      </div>
    </section>
  );
}
