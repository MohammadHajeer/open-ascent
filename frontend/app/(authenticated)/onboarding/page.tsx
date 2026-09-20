import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Get started",
  description: "Set up your Open Ascent athlete profile.",
};

export default function OnboardingPage() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <h1 className="text-3xl font-medium">Set up your athlete profile.</h1>
      <p className="mt-4 text-foreground-soft">
        Your training profile is not ready yet.
      </p>
    </main>
  );
}
