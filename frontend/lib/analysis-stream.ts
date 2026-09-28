import { ApiError, apiUrl } from "./api";
import { SseParser, type SseMessage } from "./sse-parser";
import type { AnalysisStatus, ExplanationStatus, GuestAccess, RepOutcome, RepClassification } from "./analysis";
import { parseAnalysisQueue, type AnalysisQueue } from "./analysis-progress";

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
  classification: RepClassification["variations"];
  target_match: boolean | null;
  target_deviations: NonNullable<RepClassification["target_deviations"]>;
};
type StateEvent = {
  id: null;
  type: "state";
  status: AnalysisStatus;
  stage: string;
  explanation_status: ExplanationStatus;
};
type QueueEvent = { id: null; type: "queue" } & AnalysisQueue;
type ExplanationEvent = {
  id: number;
  type: "explanation_started" | "explanation_ready" | "explanation_failed";
  attempt: number;
};
export type AnalysisProgressEvent =
  StageEvent | RepEvent | StateEvent | QueueEvent | ExplanationEvent;

const stageTypes = new Set([
  "analysis_queued", "processing_started", "video_loaded",
  "movement_analysis_started", "finalizing", "completed", "failed",
]);
const statuses = new Set([
  "reserved", "queued", "running", "completed", "failed", "expired",
]);
const outcomes = new Set(["valid", "partial", "uncertain"]);
const explanationTypes = new Set(["explanation_started", "explanation_ready", "explanation_failed"]);
const explanationStatuses = new Set(["pending", "running", "completed", "failed", "skipped"]);

export function decodeAnalysisProgress(message: SseMessage): AnalysisProgressEvent | null {
  const value: unknown = JSON.parse(message.data);
  if (!value || typeof value !== "object") return null;
  const data = value as Record<string, unknown>;
  if (message.event === "state") {
    if (typeof data.status !== "string" || !statuses.has(data.status) ||
        typeof data.stage !== "string" || typeof data.explanation_status !== "string" ||
        !explanationStatuses.has(data.explanation_status)) return null;
    return { id: null, type: "state", status: data.status as AnalysisStatus, stage: data.stage,
      explanation_status: data.explanation_status as ExplanationStatus };
  }
  if (message.event === "queue") {
    const queue = parseAnalysisQueue(data);
    return queue ? { id: null, type: "queue", ...queue } : null;
  }
  const id = Number(message.id);
  if (!message.id || !Number.isSafeInteger(id) || id < 1 ||
      typeof data.attempt !== "number" || !Number.isSafeInteger(data.attempt) || data.attempt < 0) return null;
  if (message.event === "rep_completed") {
    if (typeof data.rep_index !== "number" || !Number.isSafeInteger(data.rep_index) || data.rep_index < 1 ||
        typeof data.outcome !== "string" || !outcomes.has(data.outcome)) return null;
    return { id, type: "rep_completed", attempt: data.attempt,
      rep_index: data.rep_index, outcome: data.outcome as RepOutcome,
      classification: parseClassification(data.classification),
      target_match: typeof data.target_match === "boolean" ? data.target_match : null,
      target_deviations: parseDeviations(data.target_deviations) };
  }
  if (stageTypes.has(message.event)) {
    return { id, type: message.event as StageEvent["type"], attempt: data.attempt };
  }
  if (explanationTypes.has(message.event)) {
    return { id, type: message.event as ExplanationEvent["type"], attempt: data.attempt };
  }
  return null;
}

function parseClassification(value: unknown): RepClassification["variations"] {
  if (!value || typeof value !== "object") return {};
  const raw = value as Record<string, unknown>;
  return {
    base_movement: ["pull_up", "chin_up", "uncertain"].includes(String(raw.base_movement)) ? String(raw.base_movement) : "uncertain",
    grip_width: ["close", "standard", "wide", "uncertain"].includes(String(raw.grip_width)) ? String(raw.grip_width) : "uncertain",
    pull_height: ["standard", "high", "uncertain"].includes(String(raw.pull_height)) ? String(raw.pull_height) : "uncertain",
  };
}

function parseDeviations(value: unknown): NonNullable<RepClassification["target_deviations"]> {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is { dimension: string; expected: string; detected: string } =>
    item && typeof item.dimension === "string" && typeof item.expected === "string" && typeof item.detected === "string");
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
