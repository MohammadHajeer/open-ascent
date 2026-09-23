import Image from "next/image";
import { ScanLine } from "lucide-react";

import { Button } from "@/components/ui/button";
import { classificationLabels, targetRelation } from "@/lib/rep-classification";
import type { AnalysisStatus, RepClassification } from "@/lib/analysis";

import { ProgressStep, progressSteps } from "./progress-step";
import type { SelectedMovement } from "./types";

export function ProcessingStep({
  movement,
  status,
  stage,
  observing,
  reps,
  error,
  progressTitle,
  progressDescription,
  onRestart,
}: {
  movement: SelectedMovement;
  status: AnalysisStatus;
  stage: string;
  observing: boolean;
  reps: RepClassification[];
  error: string | null;
  progressTitle: string;
  progressDescription: string;
  onRestart: () => void;
}) {
  return (
    <section
      data-tour="guest-processing"
      className="overflow-hidden rounded-[3px_3px_34px_3px] border border-border bg-card"
      role="status"
      aria-live="polite"
    >
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-border p-6 sm:p-8">
        <div>
          <span className="font-mono text-[0.59rem] font-semibold tracking-widest text-primary uppercase">
            Step 03 / Analysis
          </span>
          <h2 className="mt-3 text-[clamp(2rem,4vw,3.5rem)] leading-none font-medium tracking-[-0.06em]">
            {progressTitle}
          </h2>
          <p className="mt-3 text-sm text-foreground-soft">
            {progressDescription}
          </p>
        </div>
        <span className="rounded-full border border-primary/40 px-3 py-1.5 font-mono text-[0.65rem] text-primary uppercase">
          {observing ? "● Live" : "Analysis"}
        </span>
      </header>

      <div className="grid lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <div className="flex min-w-0 flex-col border-b border-border bg-background-alt p-6 lg:border-r lg:border-b-0 sm:p-8">
          <span className="font-mono text-[0.59rem] tracking-widest text-foreground-faint uppercase">
            {movement.id ? "Selected target" : "Mode"}
          </span>
          <h3 className="mt-2 text-2xl font-medium tracking-tight">
            {movement.name}
          </h3>
          {!movement.id && (
            <p className="mt-2 text-sm text-foreground-soft">
              Each supported rep will be classified independently.
            </p>
          )}

          <div className="relative mx-auto mt-4 h-32 w-full max-w-80 sm:h-56 lg:mt-auto lg:h-72">
            {movement.illustrationUrl ? (
              <Image
                src={movement.illustrationUrl}
                alt=""
                fill
                sizes="(max-width: 1024px) 80vw, 35vw"
                className="object-contain"
              />
            ) : (
              <span className="grid size-full place-items-center text-primary">
                <ScanLine className="size-20" aria-hidden="true" />
              </span>
            )}
          </div>
        </div>

        <div className="flex min-w-0 flex-col p-6 sm:p-8">
          <div className="flex items-baseline justify-between gap-3">
            <h3 className="font-mono text-[0.64rem] font-semibold tracking-widest text-primary uppercase">
              Live rep analysis
            </h3>
            <span className="text-xs text-foreground-soft">
              {reps.length} detected
            </span>
          </div>

          <ol
            className="mt-4 h-72 min-h-0 space-y-3 overflow-y-auto overscroll-contain pr-1 sm:h-88"
            aria-label="Detected repetitions"
          >
            {reps.length === 0 && (
              <li className="rounded-xl border border-dashed border-border p-5 text-sm text-foreground-soft">
                Reps will appear here as they are analyzed.
              </li>
            )}

            {reps.map((rep) => {
              const labels = classificationLabels(rep);
              const relation = targetRelation(
                rep,
                !movement.id,
                movement.slug,
              );

              return (
                <li
                  key={rep.rep_index}
                  className="rounded-xl border border-border bg-background p-4"
                >
                  <div className="flex items-center justify-between gap-4">
                    <span className="font-mono text-xs text-primary">
                      REP {String(rep.rep_index).padStart(2, "0")}
                    </span>
                    <span className="rounded-full border border-border px-2 py-0.5 text-xs capitalize">
                      {rep.outcome}
                    </span>
                  </div>

                  <strong className="mt-2 block text-lg">{labels.base}</strong>

                  <div className="mt-2 flex flex-wrap gap-2 text-xs text-foreground-soft">
                    <span className="rounded-full bg-muted px-2 py-1">
                      {labels.width}
                    </span>
                    <span className="rounded-full bg-muted px-2 py-1">
                      {labels.height}
                    </span>
                  </div>

                  {relation && (
                    <p className="mt-3 border-t border-border pt-2 text-xs text-foreground-soft">
                      {relation}
                    </p>
                  )}
                </li>
              );
            })}
          </ol>
        </div>
      </div>

      <footer className="border-t border-border p-6 sm:px-8">
        <ol className="flex flex-wrap gap-x-8 gap-y-3 text-xs">
          {progressSteps(status, stage).map((item) => (
            <ProgressStep key={item.label} {...item} />
          ))}
        </ol>

        {(error || status === "failed" || status === "expired") && (
          <Button variant="outline" className="mt-6" onClick={onRestart}>
            Start a new analysis
          </Button>
        )}
      </footer>
    </section>
  );
}
