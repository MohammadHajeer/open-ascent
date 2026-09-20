import Link from "next/link";
import { ArrowLeft, ArrowUpRight } from "lucide-react";

import { BrandLogo } from "@/components/brand/brand-logo";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export default function NotFound() {
  return (
    <main className="relative isolate flex min-h-dvh flex-col overflow-hidden bg-background text-foreground">
      <div
        className="cv-grid cv-grid-radial pointer-events-none absolute inset-0 opacity-[0.16]"
        aria-hidden="true"
      />
      <div
        className="pointer-events-none absolute -top-40 -right-40 size-120 rounded-full border border-primary/15 sm:size-160"
        aria-hidden="true"
      />
      <div
        className="pointer-events-none absolute -top-16 -right-16 size-80 rounded-full border border-primary/10 sm:size-112"
        aria-hidden="true"
      />

      <header className="relative mx-auto flex w-full max-w-360 items-center gap-3 px-5 py-6 sm:px-8">
        <Link href="/" className="inline-flex items-center gap-3 rounded-lg focus-visible:ring-2 focus-visible:ring-ring">
          <BrandLogo className="size-9 rounded-full bg-logo-surface" sizes="36px" />
          <span className="text-sm font-semibold tracking-[-0.02em]">Open Ascent</span>
        </Link>
        <span className="ml-auto font-mono text-[0.55rem] font-semibold tracking-[0.14em] text-primary uppercase">
          Route / 404
        </span>
      </header>

      <section className="relative mx-auto flex w-full max-w-360 flex-1 items-center px-5 py-14 sm:px-8">
        <div className="max-w-3xl">
          <p className="font-mono text-[0.6rem] font-semibold tracking-[0.18em] text-primary uppercase">
            Outside the range
          </p>
          <p className="mt-5 text-[clamp(7rem,22vw,18rem)] leading-[0.72] font-medium tracking-[-0.105em] text-foreground/90" aria-hidden="true">
            404
          </p>
          <h1 className="mt-10 text-[clamp(2.4rem,6vw,5.5rem)] leading-[0.95] font-medium tracking-[-0.06em]">
            Movement not found.
          </h1>
          <p className="mt-5 max-w-xl text-base leading-7 text-foreground-soft">
            This route slipped outside the training range. Find your way back to Open Ascent.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/" className={cn(buttonVariants({ variant: "brand", size: "lg" }), "gap-2 px-4")}>
              <ArrowLeft className="size-4" aria-hidden="true" />
              Back to Open Ascent
            </Link>
            <Link href="/analyze" className={cn(buttonVariants({ variant: "outline", size: "lg" }), "gap-2 px-4")}>
              Analyze movement
              <ArrowUpRight className="size-4" aria-hidden="true" />
            </Link>
          </div>
        </div>
      </section>

      <footer className="relative mx-auto flex w-full max-w-360 items-center justify-between border-t border-border/75 px-5 py-5 font-mono text-[0.55rem] tracking-[0.13em] text-foreground-faint uppercase sm:px-8">
        <span>Open Ascent</span>
        <span>Find your line forward</span>
      </footer>
    </main>
  );
}
