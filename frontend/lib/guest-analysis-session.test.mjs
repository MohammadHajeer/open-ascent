import assert from "node:assert/strict";
import test from "node:test";

import {
  analysisUrlWithId,
  getGuestAnalysisSession,
  getGuestIdentityCredential,
  recoveryActionForStatus,
  removeGuestAnalysisSession,
  saveGuestAnalysisSession,
} from "./guest-analysis-session.ts";

const id = "550e8400-e29b-41d4-a716-446655440000";
const key = `open-ascent:guest-analysis:${id}`;
const access = {
  analysis_id: id,
  credential: "opaque-guest-secret",
  access_expires_at: "2026-10-01T00:00:00Z",
};

function memoryStore() {
  const entries = new Map();
  return {
    entries,
    getItem(name) { return entries.get(name) ?? null; },
    setItem(name, value) { entries.set(name, value); },
    removeItem(name) { entries.delete(name); },
  };
}

test("guest access is stored by analysis ID with only credential and expiry", () => {
  const store = memoryStore();
  assert.equal(saveGuestAnalysisSession(access, store), true);
  assert.deepEqual(JSON.parse(store.entries.get(key)), {
    credential: access.credential,
    access_expires_at: access.access_expires_at,
  });
  assert.deepEqual(getGuestAnalysisSession(id, store), access);
  assert.equal(getGuestIdentityCredential(store), access.credential);
  removeGuestAnalysisSession(id, store);
  assert.equal(store.entries.has(key), false);
  assert.equal(getGuestIdentityCredential(store), access.credential);
});

test("missing or malformed storage cannot authorize recovery", () => {
  const store = memoryStore();
  assert.equal(getGuestAnalysisSession(id, store), null);
  assert.equal(getGuestAnalysisSession("not-an-id", store), null);
  store.entries.set(key, '{"credential":""}');
  assert.equal(getGuestAnalysisSession(id, store), null);
  assert.equal(store.entries.has(key), false);
});

test("the URL contains the ID and keeps movement, never the credential", () => {
  const url = analysisUrlWithId("http://localhost:3000/analyze?movement=pull-up", id);
  assert.equal(url, `/analyze?movement=pull-up&analysis=${id}`);
  assert.equal(url.includes(access.credential), false);
});

test("each backend status selects its recovery action", () => {
  assert.equal(recoveryActionForStatus("reserved"), "reselect-video");
  assert.equal(recoveryActionForStatus("queued"), "poll");
  assert.equal(recoveryActionForStatus("running"), "poll");
  assert.equal(recoveryActionForStatus("completed"), "fetch-result");
  assert.equal(recoveryActionForStatus("failed"), "failed");
  assert.equal(recoveryActionForStatus("expired"), "expired");
});
