import type { DeterministicResult, Rep } from "@/lib/analysis";

export type Finding = { headline: string; detail: string; count: number };

const explanations: Record<string, { headline: string; detail: string }> = {
  did_not_reach_top: {
    headline: "Top position not reached",
    detail:
      "The attempt returned before the analyzer confirmed the required top position.",
  },
  tracking_lost: {
    headline: "Tracking interrupted",
    detail: "The body could not be tracked reliably during part of an attempt.",
  },
  low_landmark_confidence: {
    headline: "Body landmarks unclear",
    detail:
      "The body landmarks were not clear enough to finish evaluating an attempt.",
  },
  wrist_release_detected: {
    headline: "Bar contact unclear",
    detail:
      "The wrists appeared to move away from the confirmed bar position during an attempt.",
  },
  video_ended_during_rep: {
    headline: "Attempt cut off",
    detail: "The clip ended while an attempt was still in progress.",
  },
  too_few_usable_pose_frames: {
    headline: "Too little visible movement",
    detail:
      "There were too few usable frames to evaluate the movement reliably.",
  },
  low_usable_pose_ratio: {
    headline: "Limited tracking evidence",
    detail:
      "A substantial part of the clip did not provide usable body tracking.",
  },
  pull_up_hang_not_confirmed: {
    headline: "Starting hang not confirmed",
    detail:
      "The analyzer could not confirm a clear starting hang in this clip.",
  },
};

export function describeReason(code: string): string | null {
  return explanations[code]?.detail ?? null;
}

export function strongestFindings(result: DeterministicResult): Finding[] {
  const counts = new Map<string, number>();
  for (const rep of result.reps) {
    for (const code of rep.reason_codes)
      counts.set(code, (counts.get(code) ?? 0) + 1);
  }
  for (const code of result.evidence.reason_codes) {
    counts.set(code, (counts.get(code) ?? 0) + 1);
  }
  return [...counts.entries()]
    .filter(([code]) => code in explanations)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 3)
    .map(([code, count]) => ({ ...explanations[code], count }));
}

export function detectedMovement(reps: Rep[]): string {
  const counts = new Map<string, number>();
  for (const rep of reps) {
    const movement = rep.variations.movement;
    if (movement === "pull_up" || movement === "chin_up") {
      counts.set(movement, (counts.get(movement) ?? 0) + 1);
    }
  }
  if (!counts.size) return "Uncertain";
  const pull = counts.get("pull_up") ?? 0;
  const chin = counts.get("chin_up") ?? 0;
  if (pull === chin) return "Mixed grip evidence";
  return pull > chin ? "Pull-up" : "Chin-up";
}

export function detectedGrip(reps: Rep[]): string {
  const grips = new Set(
    reps
      .map((rep) => rep.variations.grip_orientation)
      .filter((grip) => grip === "pronated" || grip === "supinated"),
  );
  if (grips.size > 1) return "Mixed";
  if (grips.has("pronated")) return "Overhand";
  if (grips.has("supinated")) return "Underhand";
  return "Uncertain";
}
