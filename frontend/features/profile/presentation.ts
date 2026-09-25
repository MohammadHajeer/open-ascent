export const NOT_PROVIDED = "Not provided";

/** "pull_up" -> "Pull Up". Missing values read as "Not provided". */
export function label(value?: string, fallback = NOT_PROVIDED) {
  return value
    ? value.replaceAll("_", " ").replace(/\b\w/g, (match) => match.toUpperCase())
    : fallback;
}

/** Up to two initials for the profile monogram; never empty. */
export function initials(name?: string) {
  const words = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "OA";
  const first = words[0][0];
  const last = words.length > 1 ? words[words.length - 1][0] : "";
  return `${first}${last}`.toUpperCase();
}

/** Confidence is shown as a 1–3 level; unknown values return null. */
export function confidenceLevel(value?: string): 1 | 2 | 3 | null {
  switch (value?.toLowerCase()) {
    case "low":
      return 1;
    case "medium":
      return 2;
    case "high":
      return 3;
    default:
      return null;
  }
}

const MAX_WEEK_DAYS = 7;

/** Clamp a days-per-week value for the 7-segment week indicator. */
export function trainingDays(value?: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.min(MAX_WEEK_DAYS, Math.max(0, Math.round(value)));
}

const slugKey = (value: string) => value.toLowerCase().replace(/[\s_-]+/g, "_");

/** Self-reported starting value for a movement, matching slugs loosely. */
export function startingValue(
  slug: string | undefined,
  baseline: Record<string, number> | undefined,
) {
  if (!slug || !baseline) return undefined;
  const key = slugKey(slug);
  const match = Object.entries(baseline).find(([name]) => slugKey(name) === key);
  return match?.[1];
}
