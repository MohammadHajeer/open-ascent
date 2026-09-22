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
      "Pose-landmark evidence was not sufficient to fully validate this attempt.",
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
  limited_bottom_extension: {
    headline: "Bottom extension limited",
    detail: "The arms remained meaningfully flexed in a stable bottom window.",
  },
  asymmetric_bottom_extension: {
    headline: "Uneven bottom extension",
    detail: "Left and right arm extension differed meaningfully at the bottom.",
  },
  excessive_knee_bend: {
    headline: "Knee bend increased",
    detail: "Meaningful knee flexion persisted through part of the repetition.",
  },
  leg_separation: {
    headline: "Legs separated",
    detail: "Knee or ankle separation was large relative to body scale.",
  },
  lower_body_asymmetry: {
    headline: "Lower-body asymmetry",
    detail: "The two legs moved differently beyond the stable evidence threshold.",
  },
  forward_leg_movement: {
    headline: "Forward leg movement",
    detail: "Hip flexion brought the legs meaningfully forward of the body line.",
  },
  swing_detected: {
    headline: "Meaningful swing",
    detail: "Body-relative hip or ankle motion changed direction across the repetition.",
  },
  substantial_swing: {
    headline: "Substantial swing",
    detail: "Large, reversing lower-body motion was present during the repetition.",
  },
  uncontrolled_descent: {
    headline: "Abrupt descent",
    detail: "The lowering phase was both abrupt and mechanically inconsistent.",
  },
  inconsistent_descent: {
    headline: "Inconsistent descent",
    detail: "The lowering trajectory did not remain smooth and monotonic.",
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
    for (const code of rep.technique_findings ?? [])
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

export function resultHeadline(result: DeterministicResult): {
  title: string;
  subtitle: string;
} {
  const attempts =
    result.valid_rep_count +
    result.partial_rep_count +
    result.uncertain_rep_count;
  if (result.outcome === "insufficient_evidence") {
    return {
      title: "Evidence was limited.",
      subtitle: "The clip could not be evaluated reliably.",
    };
  }
  if (result.outcome === "zero_valid_reps") {
    return attempts
      ? {
          title: `${attempts} ${attempts === 1 ? "attempt" : "attempts"} detected.`,
          subtitle: "0 could be fully confirmed from pose evidence.",
        }
      : {
          title: "No attempts confirmed.",
          subtitle: "No complete attempts were detected in this clip.",
        };
  }
  return {
    title: `${result.valid_rep_count} confirmed ${result.valid_rep_count === 1 ? "rep" : "reps"}.`,
    subtitle: `${attempts} ${attempts === 1 ? "attempt" : "attempts"} analyzed.`,
  };
}

export function countMetrics(
  result: DeterministicResult,
): [string, string][] {
  const attempts =
    result.valid_rep_count +
    result.partial_rep_count +
    result.uncertain_rep_count;
  return [
    ["Confirmed reps", String(result.valid_rep_count)],
    ["Partial attempts", String(result.partial_rep_count)],
    ["Uncertain attempts", String(result.uncertain_rep_count)],
    ["Total attempts", String(attempts)],
  ];
}

export function mechanicalUncertaintySummary(
  result: DeterministicResult,
): string | null {
  const attempts =
    result.valid_rep_count +
    result.partial_rep_count +
    result.uncertain_rep_count;
  if (!attempts || !result.uncertain_rep_count) return null;

  const uncertainReps = result.reps.filter(
    (rep) => rep.outcome === "uncertain",
  );
  const allLimitedByLandmarks =
    uncertainReps.length === result.uncertain_rep_count &&
    uncertainReps.every((rep) =>
      rep.reason_codes.includes("low_landmark_confidence"),
    );
  if (!allLimitedByLandmarks) return null;

  if (result.uncertain_rep_count === attempts) {
    return attempts === 1
      ? "1 attempt was detected, but pose-landmark quality was not sufficient to fully validate it."
      : `${attempts} attempts were detected, but pose-landmark quality was not sufficient to fully validate them.`;
  }
  return `${result.uncertain_rep_count} of ${attempts} attempts could not be fully validated because pose-landmark quality was insufficient.`;
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
