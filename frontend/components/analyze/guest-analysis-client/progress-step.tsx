import { Check, LoaderCircle } from "lucide-react";

import type { AnalysisStatus } from "@/lib/analysis";

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
}: {
  label: string;
  state: ProgressStepState;
}) {
  return (
    <li
      className={`flex items-center gap-3 ${
        state === "upcoming" ? "text-foreground-faint" : "text-foreground"
      }`}
    >
      {state === "completed" ? (
        <Check className="size-4 shrink-0 text-primary" aria-hidden="true" />
      ) : state === "active" ? (
        <LoaderCircle
          className="size-4 shrink-0 animate-spin text-primary"
          aria-hidden="true"
        />
      ) : (
        <span
          className="size-4 shrink-0 rounded-full border border-border"
          aria-hidden="true"
        />
      )}
      <span>{label}</span>
    </li>
  );
}
