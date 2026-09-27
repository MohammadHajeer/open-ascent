import { Badge } from "@/components/ui/badge";
import type { PlanExercise } from "./types";

/** Distinguishes Open Ascent movements from curated supporting exercises. */
export function ExerciseKindBadge({ exercise }: { exercise: Pick<PlanExercise, "exercise_kind"> }) {
  const supporting = exercise.exercise_kind === "supporting";
  return <Badge variant={supporting ? "outline" : "secondary"} className="font-mono text-[10px] uppercase tracking-[0.08em]">
    {supporting ? "Supporting exercise" : "Supported movement"}
  </Badge>;
}

/** Why the server selected this item and how its dosage was derived. */
export function ExerciseExplanation({ exercise }: { exercise: Pick<PlanExercise, "explanation"> }) {
  return exercise.explanation ? <p className="mt-1 text-xs leading-5 text-foreground-soft">{exercise.explanation}</p> : null;
}

/** Curated instructions; supporting exercises have no Open Ascent guide or analysis. */
export function SupportingExerciseDetails({ exercise }: { exercise: Pick<PlanExercise, "supporting"> }) {
  const details = exercise.supporting;
  if (!details) return null;
  const sections: [string, string[]][] = [["Setup", details.setup], ["How to do it", details.execution], ["Common mistakes", details.common_mistakes]];
  return <details className="mt-2 text-xs leading-5 text-foreground-soft">
    <summary className="cursor-pointer font-medium text-foreground">How to do it</summary>
    <p className="mt-1">{details.purpose}</p>
    {sections.map(([title, items]) => items.length > 0 && <div key={title} className="mt-2">
      <p className="font-medium text-foreground">{title}</p>
      <ul className="list-disc pl-4">{items.map(item => <li key={item}>{item}</li>)}</ul>
    </div>)}
    <p className="mt-2 text-foreground-faint">Curated by Open Ascent. Not analyzed by video upload or Live Coach.</p>
  </details>;
}
