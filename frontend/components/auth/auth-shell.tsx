import Link from "next/link";
import { ArrowLeft, Check, ScanLine } from "lucide-react";

import { BrandLogo } from "@/components/brand/brand-logo";
import { ThemeToggle } from "@/components/shared/theme-toggle";

const accountBenefits = [
  "Live coaching access",
  "Saved movement analyses",
  "Training progress over time",
];

export function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-dvh min-w-0 bg-background xl:grid xl:grid-cols-[minmax(440px,42%)_minmax(0,1fr)] xl:items-start">
      <aside className="relative isolate hidden h-dvh self-start overflow-hidden bg-visual-surface px-10 py-8 text-visual-foreground xl:sticky xl:top-0 xl:flex xl:flex-col 2xl:px-14 2xl:py-11">
        <div
          className="pointer-events-none absolute inset-0 -z-10 overflow-hidden"
          aria-hidden="true"
        >
          <div className="cv-grid absolute inset-0 opacity-[0.09]" />
          <span className="absolute top-[14%] right-[-10%] aspect-square w-[76%] rounded-full border border-primary/35" />
          <span className="absolute top-[23%] right-[1%] aspect-square w-[54%] rounded-full border border-primary/20" />
          <span className="absolute top-[10%] right-[18%] h-[58%] w-3 border-x border-visual-foreground/15 bg-visual-foreground/5" />
          <span className="absolute top-[29%] right-[4%] h-3 w-[53%] border-y border-visual-foreground/15 bg-visual-foreground/5" />
          <span className="absolute top-[49%] right-[28%] size-3 rounded-full border-2 border-visual-surface bg-primary shadow-[0_0_0_7px_rgba(139,155,114,0.16)]" />
        </div>

        <Link
          href="/"
          className="relative z-10 flex w-fit items-center gap-3"
          aria-label="Open Ascent home"
        >
          <BrandLogo
            alt=""
            className="size-13 rounded-full bg-logo-surface dark:bg-transparent"
            sizes="52px"
          />
          <span>
            <strong className="block text-sm tracking-[-0.02em]">
              Open Ascent
            </strong>
            <small className="mt-1 block font-mono text-[0.55rem] tracking-[0.09em] text-visual-foreground/55 uppercase">
              Movement intelligence
            </small>
          </span>
        </Link>

        <div className="relative z-10 mt-auto max-w-xl pb-1">
          <span className="inline-flex items-center gap-2 font-mono text-[0.59rem] font-semibold tracking-widest text-primary uppercase">
            <ScanLine className="size-3.5" aria-hidden="true" /> Training
            continuity
          </span>
          <h2 className="mt-4 text-[clamp(3rem,5vw,6.4rem)] leading-[0.86] font-medium tracking-[-0.072em] 2xl:mt-5">
            Your movement.
            <span className="block text-primary">Remembered.</span>
          </h2>
          <p className="mt-5 max-w-md text-sm leading-6 text-visual-foreground/62 2xl:mt-6">
            Pick up where your training left off—with feedback, context, and a
            clearer view of your progress.
          </p>
          <div className="mt-6 grid grid-cols-3 gap-3 border-t border-visual-foreground/15 pt-5 2xl:mt-8 2xl:pt-7">
            {accountBenefits.map((benefit) => (
              <span
                className="flex items-start gap-2 text-xs leading-5 text-visual-foreground/60"
                key={benefit}
              >
                <Check
                  className="mt-0.5 size-3.5 shrink-0 text-primary"
                  aria-hidden="true"
                />
                {benefit}
              </span>
            ))}
          </div>
        </div>
      </aside>

      <section className="flex min-h-dvh min-w-0 flex-col bg-background">
        <header className="flex min-h-19 shrink-0 items-center justify-between border-b border-border bg-background px-4 sm:min-h-21.5 sm:px-7 xl:px-10">
          <Link
            href="/"
            className="flex min-w-0 items-center gap-2.5 text-sm font-medium text-foreground-soft transition-colors hover:text-foreground xl:hidden"
            aria-label="Open Ascent home"
          >
            <BrandLogo
              alt=""
              className="size-10.75 rounded-full bg-logo-surface dark:bg-transparent"
              sizes="43px"
            />
            <span className="truncate">Open Ascent</span>
          </Link>
          <Link
            href="/"
            className="hidden items-center gap-2 text-xs font-medium text-foreground-soft transition-colors hover:text-foreground xl:flex"
          >
            <ArrowLeft className="size-3.5" aria-hidden="true" /> Back to home
          </Link>
          <ThemeToggle />
        </header>

        <div className="grid flex-1 items-center justify-items-center px-4 py-10 sm:px-8 sm:py-12 lg:py-14 xl:px-12 xl:py-16">
          {children}
        </div>
      </section>
    </main>
  );
}
