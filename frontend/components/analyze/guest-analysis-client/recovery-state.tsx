import { LoaderCircle } from "lucide-react";

import { Button } from "@/components/ui/button";

import type { RecoveryIssue } from "./types";

export function RestoringState() {
  return (
    <section
      className="rounded-[3px_3px_34px_3px] border border-border bg-card p-8 sm:p-12"
      role="status"
      aria-live="polite"
    >
      <LoaderCircle
        className="size-6 animate-spin text-primary"
        aria-hidden="true"
      />
      <h2 className="mt-6 text-3xl font-medium tracking-tight">
        Restoring analysis…
      </h2>
      <p className="mt-3 text-sm text-foreground-soft">
        Checking its current status and access.
      </p>
    </section>
  );
}

export function UnavailableState({
  recoveryIssue,
  onRestart,
}: {
  recoveryIssue: RecoveryIssue;
  onRestart: () => void;
}) {
  return (
    <section
      className="rounded-[3px_3px_34px_3px] border border-border bg-card p-8 sm:p-12"
      aria-labelledby="recovery-title"
    >
      <span className="font-mono text-[0.59rem] font-semibold tracking-widest text-primary uppercase">
        Analysis
      </span>
      <h2
        id="recovery-title"
        className="mt-4 text-3xl font-medium tracking-tight"
      >
        {recoveryIssue === "invalid"
          ? "Analysis access expired."
          : "This analysis cannot be restored here."}
      </h2>
      <p className="mt-4 max-w-xl text-sm leading-6 text-foreground-soft">
        {recoveryIssue === "invalid"
          ? "The saved access is expired or invalid."
          : "This session has no matching access to that analysis."}
      </p>
      <Button variant="outline" className="mt-8" onClick={onRestart}>
        Start a new analysis
      </Button>
    </section>
  );
}
