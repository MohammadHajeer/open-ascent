import type { RepClassification } from "@/lib/analysis";

export function classificationLabels(rep: RepClassification) {
  const base = rep.variations.base_movement ?? rep.variations.movement;
  return {
    base: base === "pull_up" ? "Pull-Up" : base === "chin_up" ? "Chin-Up" : "Movement uncertain",
    width: ({ close: "Close grip", standard: "Standard grip", wide: "Wide grip" } as Record<string, string>)[rep.variations.grip_width ?? ""] ?? "Grip width uncertain",
    height: ({ standard: "Standard height", high: "High pull" } as Record<string, string>)[rep.variations.pull_height ?? ""] ?? "Pull height uncertain",
  };
}

export function targetRelation(rep: RepClassification, familyMode: boolean, targetSlug?: string) {
  if (familyMode) return null;
  if (rep.target_match === true) {
    const extras = [
      rep.variations.pull_height === "high" && targetSlug !== "high-pull-up" ? "high-pull variation" : null,
      rep.variations.grip_width === "close" && targetSlug !== "close-grip-pull-up" ? "close-grip variation" : null,
      rep.variations.grip_width === "wide" && targetSlug !== "wide-grip-pull-up" ? "wide-grip variation" : null,
    ].filter(Boolean);
    return extras.length ? `Matches target · Additional ${extras.join(" + ")}` : "Matches target";
  }
  if (rep.target_match === false) return "Does not match selected target";
  return "Target relation uncertain";
}

export function variationDistribution(reps: RepClassification[]): string[] {
  const counts = new Map<string, number>();
  for (const rep of reps) {
    const labels = classificationLabels(rep);
    const label = `${labels.base} · ${labels.width} · ${labels.height}`;
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return [...counts].map(([label, count]) => `${count} × ${label}`);
}
