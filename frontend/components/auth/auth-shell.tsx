import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { BrandLogo } from "@/components/brand/brand-logo";
import { ThemeToggle } from "@/components/shared/theme-toggle";

export function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative isolate flex min-h-dvh min-w-0 flex-col bg-background">
      {/* Background treatment — always behind, never competing */}
      <div
        className="pointer-events-none absolute inset-0 -z-10 overflow-hidden"
        aria-hidden="true"
      >
        <div className="cv-grid cv-grid-radial absolute inset-0 opacity-45 dark:opacity-60" />

        {/* Oversized tracking arcs */}
        <div className="absolute -top-104 -left-80 hidden size-192 rounded-full border border-border sm:block" />
        <div className="absolute -top-76 -left-52 hidden size-136 rounded-full border border-border/55 sm:block" />
        <div className="absolute -right-96 -bottom-112 hidden size-208 rounded-full border border-primary/15 lg:block" />

        {/* Technical hairlines */}
        <div className="absolute inset-x-0 top-[21%] h-px bg-linear-to-r from-transparent via-border to-transparent" />
        <div className="absolute inset-x-0 bottom-[16%] h-px bg-linear-to-r from-transparent via-primary/20 to-transparent" />
      </div>

      <header className="relative z-10 flex shrink-0 items-center justify-between gap-4 px-5 py-5 sm:px-8 sm:py-6 lg:px-12">
        <Link
          href="/"
          className="flex min-w-0 items-center gap-3 rounded-sm"
          aria-label="Open Ascent home"
        >
          <BrandLogo
            alt=""
            className="size-11 rounded-full bg-logo-surface dark:bg-transparent"
            sizes="44px"
          />

          <span className="min-w-0">
            <strong className="block truncate text-sm font-medium tracking-[-0.02em] text-foreground">
              Open Ascent
            </strong>

            <small className="mt-0.5 block font-mono text-[0.55rem] tracking-[0.13em] text-foreground-faint uppercase">
              Movement intelligence
            </small>
          </span>
        </Link>

        <div className="flex shrink-0 items-center gap-3 sm:gap-5">
          <Link
            href="/"
            className="hidden items-center gap-2 text-xs font-medium text-foreground-soft transition-colors hover:text-foreground sm:flex"
          >
            <ArrowLeft className="size-3.5" aria-hidden="true" />
            Back to home
          </Link>

          <ThemeToggle />
        </div>
      </header>

      <main className="relative z-10 flex flex-1 items-center justify-center px-5 py-8 sm:px-8 sm:py-12">
        <div className="w-full max-w-120">{children}</div>
      </main>

      <footer className="relative z-10 shrink-0 px-5 pb-8 text-center sm:pb-10">
        <p className="mx-auto max-w-sm text-xs leading-5 text-foreground-faint">
          Your analyses and movement history stay linked to your account.
        </p>
      </footer>
    </div>
  );
}
