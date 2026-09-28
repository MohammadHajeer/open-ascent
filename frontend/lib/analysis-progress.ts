import type { AnalysisStatus } from "./analysis";

// Athlete-facing view of the analysis service. The backend derives it from
// worker heartbeats; nothing here identifies workers or other analyses.
export type AnalysisServiceState = "ready" | "busy" | "unavailable";

export type AnalysisQueue = {
  service_state: AnalysisServiceState;
  // Queued analyses the worker will take first; null when not waiting.
  analyses_ahead: number | null;
};

export type ProgressCopy = { title: string; description: string };

const serviceStates = new Set<string>(["ready", "busy", "unavailable"]);

export const ANALYSIS_SERVICE_UNAVAILABLE = "analysis_service_unavailable";

export function parseAnalysisQueue(value: unknown): AnalysisQueue | null {
  if (!value || typeof value !== "object") return null;
  const data = value as Record<string, unknown>;
  if (typeof data.service_state !== "string" || !serviceStates.has(data.service_state)) {
    return null;
  }
  const ahead = data.analyses_ahead;
  return {
    service_state: data.service_state as AnalysisServiceState,
    analyses_ahead:
      typeof ahead === "number" && Number.isSafeInteger(ahead) && ahead >= 0
        ? ahead
        : null,
  };
}

/** The backend refused a new analysis because no worker is healthy. */
export function isAnalysisServiceUnavailable(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const { status, code } = error as { status?: unknown; code?: unknown };
  return status === 503 && code === ANALYSIS_SERVICE_UNAVAILABLE;
}

/**
 * Whether the page should hold back a new analysis. Only a known outage
 * blocks; an unknown state defers to the backend, which re-checks on
 * reservation. An existing reservation was already admitted and may finish
 * uploading.
 */
export function blocksNewAnalysis(
  state: AnalysisServiceState | null,
  hasReservation: boolean,
): boolean {
  return state === "unavailable" && !hasReservation;
}

export function serviceAvailabilityCopy(
  state: AnalysisServiceState | null,
): ProgressCopy | null {
  switch (state) {
    case "ready":
      return {
        title: "Analysis ready",
        description:
          "A worker is available and your analysis should start shortly.",
      };
    case "busy":
      return {
        title: "Analysis service online",
        description:
          "There are currently analyses waiting. Yours will join the queue after upload.",
      };
    case "unavailable":
      return {
        title: "Video analysis is temporarily unavailable",
        description:
          "The analysis service is currently offline. Please try again shortly.",
      };
    default:
      return null;
  }
}

function queuedCopy(queue: AnalysisQueue | null): ProgressCopy {
  if (queue?.service_state === "unavailable") {
    return {
      title: "Your analysis is safely queued",
      description:
        "The analysis service is temporarily unavailable. Your video will remain queued and processing will resume when the service is back.",
    };
  }

  const ahead = queue?.analyses_ahead;
  if (ahead === 0) {
    return {
      title: "Your analysis is next",
      description: "Waiting for the analysis worker.",
    };
  }
  if (typeof ahead === "number") {
    return {
      title: "Your analysis is queued",
      description: `${ahead} ${ahead === 1 ? "analysis" : "analyses"} ahead of you.`,
    };
  }

  return {
    title: "Your analysis is queued",
    description: "We’ve received your video and it’s waiting to be processed.",
  };
}

export function analysisProgressCopy(
  status: AnalysisStatus,
  stage: string,
  queue: AnalysisQueue | null = null,
): ProgressCopy {
  if (status === "failed") {
    return {
      title: "Analysis could not be completed",
      description:
        "We couldn’t process this video successfully. This is a processing issue, not a judgment of your movement.",
    };
  }

  if (status === "expired") {
    return {
      title: "Analysis expired",
      description:
        "This guest analysis has expired. Start a new analysis to try again.",
    };
  }

  if (status === "reserved") {
    return {
      title: "Getting your video ready",
      description: "Your upload is being prepared and checked before analysis.",
    };
  }

  if (status === "queued") return queuedCopy(queue);

  if (status === "completed") {
    return {
      title: "Your results are ready",
      description: "Opening your movement analysis results.",
    };
  }

  // Running, but the worker holding it stopped heartbeating. The job is
  // retried automatically once a worker returns.
  if (queue?.service_state === "unavailable") {
    return {
      title: "Waiting for analysis service",
      description:
        "The analysis service is temporarily unavailable. Your video is safe and processing will resume when the service is back.",
    };
  }

  if (stage === "video_loaded") {
    return {
      title: "Video ready",
      description: "Your video is ready for movement analysis.",
    };
  }

  if (stage === "movement_analysis_started" || stage === "rep_completed") {
    return {
      title: "Analyzing your movement",
      description:
        "We’re reviewing the movement and identifying completed repetitions.",
    };
  }

  if (stage === "finalizing") {
    return {
      title: "Finalizing your results",
      description:
        "We’re organizing the detected repetitions and analysis findings.",
    };
  }

  return {
    title: "Your analysis is in progress",
    description: "Your video is being analyzed.",
  };
}
