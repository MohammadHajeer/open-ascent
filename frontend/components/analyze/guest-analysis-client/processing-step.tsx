import { useEffect, useRef } from "react";
import Image from "next/image";
import { Check, ScanLine } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ThemedAsset } from "@/components/shared/themed-asset";
import { assets } from "@/lib/assets";
import { classificationLabels, targetRelation } from "@/lib/rep-classification";
import type { AnalysisStatus, RepClassification } from "@/lib/analysis";
import { cn } from "@/lib/utils";

import { ProgressStep, progressSteps } from "./progress-step";
import { StatusHeadline } from "./status-headline";
import type { SelectedMovement, StreamConnection } from "./types";

// Content inside a newly arrived rep settles in just after the card itself.
const settle = "fade-in slide-in-from-bottom-1 duration-300 ease-out fill-mode-backwards motion-safe:animate-in";

export function ProcessingStep({
  movement,
  status,
  stage,
  observing,
  connection,
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
  connection: StreamConnection;
  reps: RepClassification[];
  error: string | null;
  progressTitle: string;
  progressDescription: string;
  onRestart: () => void;
}) {
  const listRef = useRef<HTMLOListElement>(null);
  const followNewestRef = useRef(true);
  // Only a running job is computing; queued work is waiting, so the scan rests.
  const computing = observing && status === "running" && !error;

  // Keep the newest real rep in view unless the user scrolled back up to read.
  useEffect(() => {
    const list = listRef.current;
    if (!list || !followNewestRef.current || reps.length === 0) return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    list.scrollTo({ top: list.scrollHeight, behavior: reduceMotion ? "auto" : "smooth" });
  }, [reps.length]);

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
          <div className="mt-3">
            <StatusHeadline title={progressTitle} description={progressDescription} />
          </div>
        </div>
        <StreamBadge status={status} observing={observing} connection={connection} />
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

          <div className="relative mx-auto mt-4 h-32 w-full max-w-80 overflow-hidden sm:h-56 lg:mt-auto lg:h-72">
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
                {status === "failed" || status === "expired" ? (
                  <ScanLine className="size-20" aria-hidden="true" />
                ) : (
                  <ThemedAsset asset={assets.analysis.processing} alt="" width={280} />
                )}
              </span>
            )}

            {computing && (
              // A sweep that signals work in progress; it carries no progress value.
              <span
                className="pointer-events-none absolute inset-0 [mask-image:linear-gradient(to_right,transparent,black_18%,black_82%,transparent)] motion-safe:animate-oa-scan motion-reduce:hidden"
                aria-hidden="true"
              >
                <span className="absolute inset-x-0 bottom-0 h-10 bg-linear-to-b from-transparent to-primary/6" />
                <span className="absolute inset-x-0 bottom-0 h-px bg-primary/50" />
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
              <span
                key={reps.length}
                className="inline-block tabular-nums fade-in slide-in-from-bottom-1 duration-300 ease-out motion-safe:animate-in"
              >
                {reps.length}
              </span>{" "}
              detected
            </span>
          </div>

          <ol
            ref={listRef}
            onScroll={(event) => {
              const list = event.currentTarget;
              followNewestRef.current =
                list.scrollHeight - list.scrollTop - list.clientHeight < 48;
            }}
            className="mt-4 h-72 min-h-0 space-y-3 overflow-y-auto overscroll-contain pr-1 sm:h-88"
            aria-label="Detected repetitions"
          >
            {reps.length === 0 && (
              <li className="rounded-xl border border-dashed border-border p-5 text-sm text-foreground-soft">
                Reps will appear here as they are analyzed.
              </li>
            )}

            {reps.map((rep) => (
              <RepCard key={rep.rep_index} rep={rep} movement={movement} />
            ))}
          </ol>
        </div>
      </div>

      <footer className="border-t border-border p-6 sm:px-8">
        <ol className="flex flex-wrap items-center gap-x-8 gap-y-3 text-xs sm:gap-x-3">
          {progressSteps(status, stage).map((item, index) => (
            <ProgressStep key={index} index={index} {...item} />
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

// Cards mount only when a rep_completed event adds them, so the entrance marks
// a real detection. Updates to an existing rep keep its key and don't replay it.
function RepCard({
  rep,
  movement,
}: {
  rep: RepClassification;
  movement: SelectedMovement;
}) {
  const labels = classificationLabels(rep);
  const relation = targetRelation(rep, !movement.id, movement.slug);

  return (
    <li className="relative rounded-xl border border-border bg-background p-4 fade-in slide-in-from-bottom-3 duration-400 ease-out motion-safe:animate-in">
      <span
        className="pointer-events-none absolute -inset-px rounded-xl border border-primary/55 bg-primary-light animate-oa-rep-arrival"
        aria-hidden="true"
      />
      <div className="relative">
        <div className="flex items-center justify-between gap-4">
          <span className="font-mono text-xs text-primary">
            REP {String(rep.rep_index).padStart(2, "0")}
          </span>
          <span className="rounded-full border border-border px-2 py-0.5 text-xs capitalize">
            {rep.outcome}
          </span>
        </div>

        <strong className={cn("mt-2 block text-lg delay-100", settle)}>
          {labels.base}
        </strong>

        <div className={cn("mt-2 flex flex-wrap gap-2 text-xs text-foreground-soft delay-200", settle)}>
          <span className="rounded-full bg-muted px-2 py-1">
            {labels.width}
          </span>
          <span className="rounded-full bg-muted px-2 py-1">
            {labels.height}
          </span>
        </div>

        {relation && (
          <p className={cn("mt-3 border-t border-border pt-2 text-xs text-foreground-soft delay-300", settle)}>
            {relation}
          </p>
        )}
      </div>
    </li>
  );
}

// Reflects the actual stream: "Live" only while a connection is delivering events.
function StreamBadge({
  status,
  observing,
  connection,
}: {
  status: AnalysisStatus;
  observing: boolean;
  connection: StreamConnection;
}) {
  const state =
    status === "completed"
      ? "complete"
      : !observing
        ? "idle"
        : connection;

  return (
    <span className="flex items-center gap-2 rounded-full border border-primary/40 px-3 py-1.5 font-mono text-[0.65rem] text-primary uppercase transition-colors duration-500">
      <span key={state} className="flex items-center gap-2 fade-in duration-300 motion-safe:animate-in">
        {state === "complete" ? (
          <Check className="size-3" aria-hidden="true" />
        ) : state === "live" ? (
          <span className="size-1.5 rounded-full bg-primary motion-safe:animate-oa-live-pulse" aria-hidden="true" />
        ) : state !== "idle" ? (
          <span className="size-1.5 rounded-full border border-primary/60" aria-hidden="true" />
        ) : null}
        {state === "complete"
          ? "Complete"
          : state === "live"
            ? "Live"
            : state === "reconnecting"
              ? "Reconnecting"
              : state === "connecting"
                ? "Connecting"
                : "Analysis"}
      </span>
    </span>
  );
}
