"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { getPlanPreview, savePlanPreview } from "./api";
import type { PlanPreview } from "./types";

export function PlanPreviewCard({ previewId, onSaved }: { previewId: string; onSaved?: () => void }) {
  const [preview, setPreview] = useState<PlanPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let live = true;
    getPlanPreview(previewId).then(value => {
      if (live) setPreview(value);
    }).catch(cause => {
      if (live) setError(cause instanceof Error ? cause.message : "Could not load plan preview.");
    });
    return () => { live = false; };
  }, [previewId]);

  async function save() {
    if (!preview || saving || preview.saved_plan_id) return;
    setSaving(true);
    setError(null);
    try {
      const result = await savePlanPreview(previewId);
      setPreview(current => current ? { ...current, saved_plan_id: result.id } : current);
      onSaved?.();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save plan. Review current readiness and try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="mt-4 rounded-xl border border-border bg-card p-4 sm:p-5" aria-label="Weekly plan preview">
      {error && <p role="alert" className="mb-3 text-sm text-destructive">{error}</p>}
      {!preview ? <p className="text-sm text-foreground-soft">Loading plan preview…</p> : <>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.13em] text-primary">{preview.saved_plan_id ? "Saved plan" : "Preview · not saved"}</p>
            <h3 className="mt-1 text-lg font-medium text-foreground">{preview.title}</h3>
          </div>
          <Button onClick={() => void save()} disabled={saving || Boolean(preview.saved_plan_id)} size="sm">{preview.saved_plan_id ? "Saved" : saving ? "Saving…" : "Save Plan"}</Button>
        </div>
        {preview.summary && <p className="mt-2 text-sm leading-6 text-foreground-soft">{preview.summary}</p>}
        {preview.origin && <div className="mt-3 rounded-lg bg-background-alt/50 p-3 text-xs leading-5 text-foreground-soft">
          <p className="font-semibold text-foreground">{preview.origin.mode === "profile" ? "Start from my profile" : preview.origin.mode === "goal" ? "Build toward a goal" : "Adapt to my progress"}{preview.origin.goal_name ? ` · ${preview.origin.goal_name}` : ""}</p>
          <p>Based on: {preview.origin.based_on.join(" · ")}</p>
        </div>}
        {preview.provisional_readiness && <Alert className="mt-3"><AlertTitle>Provisional readiness</AlertTitle><AlertDescription>Based partly on your self-reported readiness. Open Ascent will refine future plans as you log training and analysis evidence.</AlertDescription></Alert>}
        <div className="mt-4 space-y-3">
          {preview.days.map(day => <div key={day.day_index} className="rounded-lg border border-border/70 bg-background-alt/30 p-3">
            <h4 className="text-sm font-semibold text-foreground">Day {day.day_index}{day.label ? ` · ${day.label}` : ""}</h4>
            <ul className="mt-2 space-y-2 text-sm text-foreground-soft">
              {day.exercises.map((exercise, index) => <li key={`${exercise.movement_id}-${index}`} className="border-t border-border/50 pt-2 first:border-0 first:pt-0">
                {exercise.movement_slug ? <a className="font-medium text-foreground underline decoration-border underline-offset-2 hover:text-primary" href={`/movements/${encodeURIComponent(exercise.movement_slug)}`} target="_blank" rel="noopener noreferrer">{exercise.movement_name} <span className="sr-only">safety guide opens in a new tab</span></a> : <span className="font-medium text-foreground">{exercise.movement_name}</span>} · {exercise.sets} sets × {exercise.reps !== null ? `${exercise.reps} reps` : `${exercise.hold_seconds} sec hold`} · {exercise.rest_seconds} sec rest
                {exercise.notes && <p className="mt-0.5 text-xs">{exercise.notes}</p>}
              </li>)}
            </ul>
          </div>)}
        </div>
        <p className="mt-3 text-xs leading-5 text-foreground-faint">Review each movement’s published safety guidance before training. Readiness was checked against accepted evidence when this preview was generated and is checked again when you save.</p>
        {preview.saved_plan_id && <Link href={`/dashboard/library/${preview.saved_plan_id}`} className="mt-4 inline-block text-sm font-medium text-primary underline underline-offset-4">View saved plan in Library</Link>}
      </>}
    </section>
  );
}
