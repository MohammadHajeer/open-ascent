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

// Form cues need sustained evidence. Knee flexion is deliberately absent: from
// the recommended front camera it happens along the depth axis, which a 2D
// knee angle barely registers, and a bent-knee hang is normal on a low bar.
export const FORM_EVIDENCE = {
  // Bent-arm hang before counting starts. One second separates an athlete
  // still settling into the hang (or re-hanging after a tracking reset) from
  // one who needs to extend.
  extensionAngleMaxDeg: 140,
  extensionMinMs: 1000,
  extensionMinSamples: 3,
  // Lower-body sway relative to the wrists, in torso lengths. A front camera
  // sees side-to-side sway; front-to-back swing is mostly along the depth axis.
  swingWindowMs: 1200,
  swingMinSamples: 5,
  swingMinRange: 0.30,
  swingMinStep: 0.05,
} as const;
