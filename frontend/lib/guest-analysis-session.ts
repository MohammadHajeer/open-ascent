"use client";

import type { AnalysisStatus, GuestAccess } from "./analysis";

const PREFIX = "open-ascent:guest-analysis:";
const ANALYSIS_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type SessionStore = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function browserStore(): SessionStore | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

function keyFor(analysisId: string) {
  return `${PREFIX}${analysisId}`;
}

export function analysisUrlWithId(href: string, analysisId: string) {
  if (!ANALYSIS_ID.test(analysisId)) throw new Error("Invalid analysis ID.");
  const url = new URL(href);
  url.searchParams.set("analysis", analysisId);
  return `${url.pathname}${url.search}${url.hash}`;
}

export function saveGuestAnalysisSession(
  access: GuestAccess,
  store: SessionStore | null = browserStore(),
) {
  if (!store || !ANALYSIS_ID.test(access.analysis_id)) return false;
  try {
    store.setItem(
      keyFor(access.analysis_id),
      JSON.stringify({
        credential: access.credential,
        access_expires_at: access.access_expires_at,
      }),
    );
    return true;
  } catch {
    return false;
  }
}

export function getGuestAnalysisSession(
  analysisId: string,
  store: SessionStore | null = browserStore(),
): GuestAccess | null {
  if (!store || !ANALYSIS_ID.test(analysisId)) return null;
  try {
    const raw = store.getItem(keyFor(analysisId));
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    if (
      !value ||
      typeof value !== "object" ||
      !("credential" in value) ||
      typeof value.credential !== "string" ||
      !value.credential ||
      !("access_expires_at" in value) ||
      typeof value.access_expires_at !== "string" ||
      !Number.isFinite(Date.parse(value.access_expires_at))
    ) {
      store.removeItem(keyFor(analysisId));
      return null;
    }
    return {
      analysis_id: analysisId,
      credential: value.credential,
      access_expires_at: value.access_expires_at,
    };
  } catch {
    removeGuestAnalysisSession(analysisId, store);
    return null;
  }
}

export function removeGuestAnalysisSession(
  analysisId: string,
  store: SessionStore | null = browserStore(),
) {
  if (!store || !ANALYSIS_ID.test(analysisId)) return;
  try {
    store.removeItem(keyFor(analysisId));
  } catch {
    // A disabled browser storage area should not block in-memory analysis.
  }
}

export function recoveryActionForStatus(status: AnalysisStatus) {
  switch (status) {
    case "reserved":
      return "reselect-video";
    case "queued":
    case "running":
      return "poll";
    case "completed":
      return "fetch-result";
    case "failed":
      return "failed";
    case "expired":
      return "expired";
  }
}
