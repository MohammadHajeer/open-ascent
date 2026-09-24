export const LIVE_VERTICAL_PULL_MOVEMENTS = [
  { slug: "pull-up", label: "Pull-Up" },
  { slug: "chin-up", label: "Chin-Up" },
  { slug: "close-grip-pull-up", label: "Close-Grip Pull-Up" },
  { slug: "wide-grip-pull-up", label: "Wide-Grip Pull-Up" },
  { slug: "high-pull-up", label: "High Pull-Up" },
] as const;

export type LiveVerticalPullMovement = (typeof LIVE_VERTICAL_PULL_MOVEMENTS)[number]["slug"];

export const PARTIAL_VERTICAL_PULL_VARIANTS = [
  { slug: "close-vertical-pull", label: "Close Vertical Pull" },
  { slug: "wide-vertical-pull", label: "Wide Vertical Pull" },
  { slug: "high-vertical-pull", label: "High Vertical Pull" },
  { slug: "standard-width-vertical-pull", label: "Standard-Width Vertical Pull" },
  { slug: "standard-height-vertical-pull", label: "Standard-Height Vertical Pull" },
] as const;

export type VerticalPullVariant = LiveVerticalPullMovement |
  (typeof PARTIAL_VERTICAL_PULL_VARIANTS)[number]["slug"] | "unknown";

export function verticalPullVariantLabel(variant: VerticalPullVariant) {
  return [...LIVE_VERTICAL_PULL_MOVEMENTS, ...PARTIAL_VERTICAL_PULL_VARIANTS]
    .find((item) => item.slug === variant)?.label ?? "Unknown variant";
}

export function emptyVariantBreakdown(): Record<VerticalPullVariant, number> {
  return {
    "pull-up": 0,
    "chin-up": 0,
    "close-grip-pull-up": 0,
    "wide-grip-pull-up": 0,
    "high-pull-up": 0,
    "close-vertical-pull": 0,
    "wide-vertical-pull": 0,
    "high-vertical-pull": 0,
    "standard-width-vertical-pull": 0,
    "standard-height-vertical-pull": 0,
    unknown: 0,
  };
}

export const VARIANT_EVIDENCE = {
  closeWidthRatioMax: 0.90,
  standardWidthRatioMin: 0.98,
  standardWidthRatioMax: 1.50,
  wideWidthRatioMin: 1.60,
  highUpperTorsoToWristRatioMax: 0.10,
  standardUpperTorsoToWristRatioMin: 0.22,
  // Only a small resolution floor; the decision itself uses a torso ratio.
  minTorsoSpanForHeight: 0.025,
} as const;
