export const LIVE_VERTICAL_PULL_MOVEMENTS = [
  { slug: "pull-up", label: "Pull-Up" },
  { slug: "chin-up", label: "Chin-Up" },
  { slug: "close-grip-pull-up", label: "Close-Grip Pull-Up" },
  { slug: "wide-grip-pull-up", label: "Wide-Grip Pull-Up" },
  { slug: "high-pull-up", label: "High Pull-Up" },
] as const;

export type LiveVerticalPullMovement = (typeof LIVE_VERTICAL_PULL_MOVEMENTS)[number]["slug"];

export type VerticalPullVariant = LiveVerticalPullMovement | "unknown";

export function emptyVariantBreakdown(): Record<VerticalPullVariant, number> {
  return {
    "pull-up": 0,
    "chin-up": 0,
    "close-grip-pull-up": 0,
    "wide-grip-pull-up": 0,
    "high-pull-up": 0,
    unknown: 0,
  };
}

export const VARIANT_EVIDENCE = {
  closeWidthRatioMax: 0.85,
  standardWidthRatioMin: 1.0,
  standardWidthRatioMax: 1.4,
  wideWidthRatioMin: 1.65,
  highUpperTorsoToWristRatioMax: 0.10,
} as const;
