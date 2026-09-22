"use client";

import { useQuery } from "@tanstack/react-query";
import { SlidersHorizontal } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { fetchAnalysisHistory } from "@/features/analysis/api";
import { analysisKeys } from "@/features/analysis/keys";

import type { WorkoutLoggerController } from "../use-workout-logger";
import type { WorkoutIntent, WorkoutPerformer, WorkoutSource } from "../types";
import { Field } from "./field";

const SOURCE_ITEMS = [
  { value: "manual", label: "Manual" },
  { value: "self_reported", label: "Self-reported" },
  { value: "uploaded_analysis", label: "Uploaded analysis" },
  { value: "live_coach", label: "Live Coach" },
] as const;

const PERFORMER_ITEMS = [
  { value: "self", label: "Self" },
  { value: "other", label: "Other person" },
  { value: "unknown", label: "Unknown" },
] as const;

const INTENT_ITEMS = [
  { value: "training_set", label: "Training set" },
  { value: "assessment", label: "Assessment" },
  { value: "max_test", label: "Max test" },
  { value: "skill_attempt", label: "Skill attempt" },
] as const;

const analysisDate = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

export function LoggingDetails({ controller }: { controller: WorkoutLoggerController }) {
  const analysisHistory = useQuery({
    queryKey: analysisKeys.history(100),
    queryFn: () => fetchAnalysisHistory(100),
    enabled: controller.source === "uploaded_analysis",
  });
  const eligibleAnalyses = analysisHistory.data?.filter(
    (item) => item.status === "completed" && item.movement.id === controller.movementId,
  ) ?? [];
  const analysisItems = eligibleAnalyses.map((item) => ({
    value: item.analysis_id,
    label: `${item.movement.name} analysis · ${analysisDate.format(new Date(item.completed_at ?? item.created_at))}`,
  }));

  return (
    <div className="rounded-2xl border border-border/70 bg-background/30">
      <Button
        type="button"
        variant="ghost"
        aria-expanded={controller.showDetails}
        aria-controls="workout-logging-details"
        className="flex h-auto w-full items-center justify-between gap-4 whitespace-normal px-4 py-3.5 text-left"
        onClick={() => controller.setShowDetails((current) => !current)}
      >
        <span className="flex items-center gap-3">
          <span className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <SlidersHorizontal className="size-4" aria-hidden="true" />
          </span>
          <span>
            <span className="block text-sm font-medium">Logging details</span>
            <span className="mt-0.5 block text-xs text-foreground-faint">Source, performer and set intent</span>
          </span>
        </span>
        <span className="text-xs text-foreground-faint">{controller.showDetails ? "Hide" : "Edit"}</span>
      </Button>

      {controller.showDetails && (
        <div id="workout-logging-details" className="grid gap-4 border-t border-border/70 px-4 py-4 sm:grid-cols-2">
          <Field id="workout-source" label="Source">
            <Select
              items={SOURCE_ITEMS}
              value={controller.source}
              onValueChange={(selected) => {
                if (selected) {
                  controller.setSource(selected as WorkoutSource);
                  controller.setAnalysisId("");
                }
              }}
            >
              <SelectTrigger id="workout-source" className="h-11 w-full rounded-xl bg-background/70"><SelectValue /></SelectTrigger>
              <SelectContent>
                {SOURCE_ITEMS.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>

          <Field id="workout-performer" label="Performer">
            <Select items={PERFORMER_ITEMS} value={controller.performer} onValueChange={(selected) => {
              if (selected) controller.setPerformer(selected as WorkoutPerformer);
            }}>
              <SelectTrigger id="workout-performer" className="h-11 w-full rounded-xl bg-background/70"><SelectValue /></SelectTrigger>
              <SelectContent>
                {PERFORMER_ITEMS.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>

          <Field id="workout-intent" label="Set intent">
            <Select items={INTENT_ITEMS} value={controller.intent} onValueChange={(selected) => {
              if (selected) controller.setIntent(selected as WorkoutIntent);
            }}>
              <SelectTrigger id="workout-intent" className="h-11 w-full rounded-xl bg-background/70"><SelectValue /></SelectTrigger>
              <SelectContent>
                {INTENT_ITEMS.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>

          {controller.source === "uploaded_analysis" && (
            <Field id="workout-analysis" label="Completed analysis" hint="For the selected movement">
              <Select
                items={analysisItems}
                value={controller.analysisId || null}
                onValueChange={(selected) => controller.setAnalysisId(selected ?? "")}
              >
                <SelectTrigger id="workout-analysis" className="h-11 w-full rounded-xl bg-background/70" aria-describedby="workout-analysis-hint">
                  <SelectValue placeholder="Choose analysis" />
                </SelectTrigger>
                <SelectContent>
                  {analysisItems.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}
                </SelectContent>
              </Select>
              {analysisHistory.isError ? (
                <p role="alert" className="text-xs text-destructive">Analyses could not be loaded.</p>
              ) : !analysisHistory.isPending && !analysisItems.length ? (
                <p className="text-xs text-foreground-faint">No completed analyses are available for this movement.</p>
              ) : null}
            </Field>
          )}

          {controller.source === "live_coach" && (
            <Field id="workout-live-coach-ref" label="Live Coach reference" hint="Optional session reference">
              <Input
                id="workout-live-coach-ref"
                className="h-11 rounded-xl bg-background/70"
                value={controller.liveCoachRef}
                onChange={(event) => controller.setLiveCoachRef(event.target.value)}
                maxLength={200}
                aria-describedby="workout-live-coach-ref-hint"
                placeholder="Session reference"
              />
            </Field>
          )}
        </div>
      )}
    </div>
  );
}
