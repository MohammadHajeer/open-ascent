import { createClient as createBrowserSupabaseClient } from "@/lib/supabase/client";
import { ApiError } from "@/lib/api";
import { authApiFetch, authApiRequest } from "@/lib/auth-api";
import { decodeAnalysisProgress, type AnalysisProgressEvent } from "@/lib/analysis-stream";
import { SseParser } from "@/lib/sse-parser";
import type { AnalysisStatus } from "@/lib/analysis";

import type {
  AnalysisHistoryItem,
  AuthenticatedAnalysisAccess,
  AuthenticatedAnalysisResult,
} from "./types";

type UploadAuthorization = {
  bucket: string;
  path: string;
  token: string;
  max_size_bytes: number;
  allowed_content_types: string[];
};

export async function reserveAuthenticatedAnalysis(
  movementId: string | null,
  safetyDocumentationId: string,
  safetyAckVersion: string,
): Promise<AuthenticatedAnalysisAccess> {
  const reservation = await authApiFetch<{ analysis_id: string }>("/analyses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": crypto.randomUUID(),
    },
    body: JSON.stringify({
      ...(movementId ? { movement_id: movementId } : { family_key: "vertical_pull" }),
      safety_documentation_id: safetyDocumentationId,
      safety_ack_version: safetyAckVersion,
    }),
  });
  return { analysis_id: reservation.analysis_id, kind: "authenticated" };
}

export async function uploadAuthenticatedVideo(
  access: AuthenticatedAnalysisAccess,
  file: File,
) {
  const upload = await authApiFetch<UploadAuthorization>(
    `/analyses/${access.analysis_id}/upload`,
    { method: "POST" },
  );
  if (file.size > upload.max_size_bytes || !upload.allowed_content_types.includes("video/mp4")) {
    throw new Error("This video does not meet the upload requirements.");
  }
  const { error } = await createBrowserSupabaseClient().storage
    .from(upload.bucket)
    .uploadToSignedUrl(upload.path, upload.token, file, { contentType: "video/mp4" });
  if (error) throw new Error(error.message);
  await authApiFetch(`/analyses/${access.analysis_id}/finalize`, { method: "POST" });
}

export const fetchAuthenticatedAnalysisStatus = (analysisId: string) =>
  authApiFetch<{ status: AnalysisStatus; stage: string }>(
    `/analyses/${analysisId}/status`,
    { cache: "no-store" },
  );

export const fetchAuthenticatedAnalysisResult = (analysisId: string) =>
  authApiFetch<AuthenticatedAnalysisResult>(`/analyses/${analysisId}/result`, {
    cache: "no-store",
  });

export const retryAuthenticatedExplanation = (analysisId: string) =>
  authApiFetch<{ explanation_status: "pending" | "running" }>(
    `/analyses/${analysisId}/explanation/retry`,
    { method: "POST" },
  );

export const fetchAnalysisHistory = (limit = 50) =>
  authApiFetch<AnalysisHistoryItem[]>(`/analyses?limit=${limit}`, { cache: "no-store" });

export async function streamAuthenticatedAnalysis(
  analysisId: string,
  lastEventId: number,
  signal: AbortSignal,
  onEvent: (event: AnalysisProgressEvent) => void | Promise<void>,
) {
  const response = await authApiRequest(`/analyses/${analysisId}/events`, {
    headers: {
      Accept: "text/event-stream",
      ...(lastEventId ? { "Last-Event-ID": String(lastEventId) } : {}),
    },
    cache: "no-store",
    signal,
  });
  if (!response.ok) {
    throw new ApiError(response.status, "stream_error", "Live progress is unavailable.");
  }
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
