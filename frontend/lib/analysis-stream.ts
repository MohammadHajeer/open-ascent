import { ApiError, apiUrl } from "./api";
import { SseParser, type SseMessage } from "./sse-parser";
import type { AnalysisStatus, GuestAccess, RepOutcome } from "./analysis";

type StageEvent = {
  id: number;
  type: "analysis_queued" | "processing_started" | "video_loaded" |
    "movement_analysis_started" | "finalizing" | "completed" | "failed";
  attempt: number;
};
type RepEvent = {
  id: number;
  type: "rep_completed";
  attempt: number;
  rep_index: number;
  outcome: RepOutcome;
};
type StateEvent = {
  id: null;
  type: "state";
  status: AnalysisStatus;
  stage: string;
};
export type AnalysisProgressEvent = StageEvent | RepEvent | StateEvent;

const stageTypes = new Set([
  "analysis_queued", "processing_started", "video_loaded",
  "movement_analysis_started", "finalizing", "completed", "failed",
]);
const statuses = new Set([
  "reserved", "queued", "running", "completed", "failed", "expired",
]);
const outcomes = new Set(["valid", "partial", "uncertain"]);

export function decodeAnalysisProgress(message: SseMessage): AnalysisProgressEvent | null {
  const value: unknown = JSON.parse(message.data);
  if (!value || typeof value !== "object") return null;
  const data = value as Record<string, unknown>;
  if (message.event === "state") {
    if (typeof data.status !== "string" || !statuses.has(data.status) ||
        typeof data.stage !== "string") return null;
    return { id: null, type: "state", status: data.status as AnalysisStatus, stage: data.stage };
  }
  const id = Number(message.id);
  if (!message.id || !Number.isSafeInteger(id) || id < 1 ||
      typeof data.attempt !== "number" || !Number.isSafeInteger(data.attempt) || data.attempt < 0) return null;
  if (message.event === "rep_completed") {
    if (typeof data.rep_index !== "number" || !Number.isSafeInteger(data.rep_index) || data.rep_index < 1 ||
        typeof data.outcome !== "string" || !outcomes.has(data.outcome)) return null;
    return { id, type: "rep_completed", attempt: data.attempt,
      rep_index: data.rep_index, outcome: data.outcome as RepOutcome };
  }
  if (stageTypes.has(message.event)) {
    return { id, type: message.event as StageEvent["type"], attempt: data.attempt };
  }
  return null;
}

export async function streamGuestAnalysis(
  access: GuestAccess,
  lastEventId: number,
  signal: AbortSignal,
  onEvent: (event: AnalysisProgressEvent) => void | Promise<void>,
): Promise<void> {
  const response = await fetch(apiUrl(`/analyses/${access.analysis_id}/events`), {
    headers: {
      Authorization: `Bearer ${access.credential}`,
      Accept: "text/event-stream",
      ...(lastEventId ? { "Last-Event-ID": String(lastEventId) } : {}),
    },
    cache: "no-store",
    signal,
  });
  if (!response.ok) throw new ApiError(response.status, "stream_error",
    response.status === 401 ? "Guest access expired." : "Live progress is unavailable.");
  if (!response.body) throw new Error("Live progress is unavailable.");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const parser = new SseParser();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      for (const message of parser.push(decoder.decode(value, { stream: true }))) {
        const event = decodeAnalysisProgress(message);
        if (event) await onEvent(event);
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
