import type { Metadata } from "next";
import Link from "next/link";

import { BrandLogo } from "@/components/brand/brand-logo";
import { OnboardingForm } from "@/components/onboarding/onboarding-form";
import { ThemeToggle } from "@/components/shared/theme-toggle";

export const metadata: Metadata = {
  title: "Get started",
  description: "Set up your Open Ascent athlete profile.",
};

export default function OnboardingPage() {
  return (
    <div className="relative isolate min-h-dvh overflow-hidden bg-background text-foreground">
      <div
        className="cv-grid cv-grid-radial pointer-events-none absolute inset-0 -z-10 opacity-45"
        aria-hidden="true"
      />
      <div
        className="pointer-events-none absolute -top-48 -right-32 -z-10 size-96 rounded-full border border-primary/15"
        aria-hidden="true"
      />
      <div
        className="pointer-events-none absolute -top-28 -right-12 -z-10 size-64 rounded-full border border-border"
        aria-hidden="true"
      />
      <header className="mx-auto flex max-w-5xl items-center justify-between px-5 py-6 sm:px-8">
        <Link
          href="/"
          className="flex items-center gap-3"
          aria-label="Open Ascent home"
        >
          <BrandLogo
            alt=""
            className="size-11 rounded-full bg-logo-surface dark:bg-transparent"
            sizes="44px"
          />
          <span>
            <strong className="block text-sm font-medium tracking-tight">
              Open Ascent
            </strong>
            <small className="font-mono text-[0.55rem] tracking-[0.13em] text-foreground-faint uppercase">
              Movement intelligence
            </small>
          </span>
        </Link>
        <ThemeToggle />
      </header>
      <main className="mx-auto w-full max-w-5xl px-5 pt-8 pb-20 sm:px-8 sm:pt-12">
        <OnboardingForm />
      </main>
    </div>
  );
}
