/** Theme names describe the intended background surface, not the ink color. */
export type AssetTheme = "light" | "dark";

export type ThemedAssetSource = Readonly<{
  light: string;
  dark: string;
  width: number;
  height: number;
}>;

// If next.config uses basePath, prepend that same base path here once.
const ROOT = "/assets" as const;

function themed<const P extends string>(
  path: P,
  width: number,
  height: number,
) {
  return {
    light: `${ROOT}/${path}-light.svg`,
    dark: `${ROOT}/${path}-dark.svg`,
    width,
    height,
  } as const satisfies ThemedAssetSource;
}

function appIcon<const S extends number>(size: S) {
  return {
    light: `${ROOT}/brand/icons/app-icon-light-${size}.png`,
    dark: `${ROOT}/brand/icons/app-icon-dark-${size}.png`,
    width: size,
    height: size,
  } as const satisfies ThemedAssetSource;
}

/** Public URLs only: no React, theme provider, SVG loader or client boundary. */
export const assets = {
  brand: {
    symbol: themed("brand/symbol", 1024, 1024),
    icons: {
      favicon32: appIcon(32),
      favicon48: appIcon(48),
      app192: appIcon(192),
      app512: appIcon(512),
      appleTouch: {
        src: `${ROOT}/brand/icons/apple-touch-icon.png`,
        width: 180,
        height: 180,
      },
    },
  },
  social: {
    openGraph: {
      src: `${ROOT}/social/open-graph.png`,
      width: 1200,
      height: 630,
      alt: "Open Ascent — AI Calisthenics Coach. Train with clarity.",
    },
  },
  analysis: {
    processing: themed("analysis/processing", 608, 224),
  },
  emptyStates: {
    noAnalyses: themed("empty-states/no-analyses", 256, 192),
    noWorkouts: themed("empty-states/no-workouts", 256, 192),
    noTrainingPlan: themed("empty-states/no-training-plan", 256, 192),
    noCoachConversations: themed(
      "empty-states/no-coach-conversations",
      256,
      192,
    ),
    noProgressData: themed("empty-states/no-progress-data", 256, 192),
  },
  safety: {
    safetyGuidance: themed("safety/safety-guidance", 24, 24),
    difficulty: themed("safety/difficulty", 24, 24),
    stressedBodyAreas: themed("safety/stressed-body-areas", 24, 24),
    prerequisites: themed("safety/prerequisites", 24, 24),
    caution: themed("safety/caution", 24, 24),
    stopCondition: themed("safety/stop-condition", 24, 24),
    easierOption: themed("safety/easier-option", 24, 24),
    progression: themed("safety/progression", 24, 24),
    equipmentSetup: themed("safety/equipment-setup", 24, 24),
    readinessStatus: themed("safety/readiness-status", 24, 24),
  },
  subscription: {
    proHorizontal: themed("subscription/pro-horizontal", 278, 64),
    proPill: themed("subscription/pro-pill", 218, 60),
  },
  status: {
    checkpointLoop: themed("status/checkpoint-loop", 64, 64),
    movementArc: themed("status/movement-arc", 64, 64),
    repCadence: themed("status/rep-cadence", 64, 64),
    measurementTraverse: themed("status/measurement-traverse", 64, 64),
  },
} as const;
