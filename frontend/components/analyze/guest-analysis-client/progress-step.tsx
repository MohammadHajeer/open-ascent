import { Check } from "lucide-react";

import type { AnalysisStatus } from "@/lib/analysis";
import { cn } from "@/lib/utils";

export type ProgressStepState = "completed" | "active" | "upcoming";

export function progressSteps(
  status: AnalysisStatus,
  stage: string,
): {
  label: string;
  state: ProgressStepState;
}[] {
  const uploaded = status !== "reserved";
  const finalizing = stage === "finalizing" || status === "completed";
  const analyzing =
    stage === "movement_analysis_started" ||
    stage === "rep_completed" ||
    finalizing;
  const preparing = status === "running" && !analyzing;

  return [
    {
      label: uploaded ? "Video uploaded" : "Video upload",
      state: uploaded ? "completed" : "active",
    },
    {
      label: preparing ? "Preparing analysis" : "Movement analysis",
      state: finalizing
        ? "completed"
        : analyzing || preparing
          ? "active"
          : "upcoming",
    },
    {
      label: "Results preparation",
      state:
        status === "completed"
          ? "completed"
          : finalizing
            ? "active"
            : "upcoming",
    },
  ];
}

export function ProgressStep({
  label,
  state,
  index,
}: {
  label: string;
  state: ProgressStepState;
  index: number;
}) {
  return (
    <li
      className={cn(
        "flex items-center gap-3 transition-colors duration-500",
        state === "upcoming" ? "text-foreground-faint" : "text-foreground",
      )}
    >
      {index > 0 && (
        // Fills once the real flow reaches this stage; it never shows partial progress.
        <span
          className="relative hidden h-px w-8 overflow-hidden bg-border sm:block"
          aria-hidden="true"
        >
          <span
            className={cn(
              "absolute inset-0 origin-left bg-primary transition-transform duration-500 ease-out",
              state === "upcoming" ? "scale-x-0" : "scale-x-100",
            )}
          />
        </span>
      )}
      <StepMarker key={state} state={state} index={index} />
      <span
        key={label}
        className="fade-in duration-300 motion-safe:animate-in"
      >
        {label}
      </span>
    </li>
  );
}

function StepMarker({
  state,
  index,
}: {
  state: ProgressStepState;
  index: number;
}) {
  if (state === "completed") {
    return (
      <Check
        className="size-4 shrink-0 text-primary zoom-in-50 fade-in duration-300 ease-out fill-mode-backwards motion-safe:animate-in"
        // When several stages resolve on one event, they settle left to right.
        style={{ animationDelay: `${index * 90}ms` }}
        aria-hidden="true"
      />
    );
  }

  if (state === "active") {
    return (
      <span
        className="grid size-4 shrink-0 place-items-center rounded-full border border-primary/45 zoom-in-75 fade-in duration-300 motion-safe:animate-in"
        aria-hidden="true"
      >
        <span className="size-1.5 rounded-full bg-primary motion-safe:animate-oa-breathe" />
      </span>
    );
  }

  return (
    <span
      className="size-4 shrink-0 rounded-full border border-border"
      aria-hidden="true"
    />
  );
}
