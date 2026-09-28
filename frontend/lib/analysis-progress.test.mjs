import assert from "node:assert/strict";
import test from "node:test";

import {
  analysisProgressCopy,
  blocksNewAnalysis,
  isAnalysisServiceUnavailable,
  parseAnalysisQueue,
  serviceAvailabilityCopy,
} from "./analysis-progress.ts";

const queue = (service_state, analyses_ahead = null) => ({
  service_state,
  analyses_ahead,
});

test("new analyses are held back only for a known outage without a reservation", () => {
  assert.equal(blocksNewAnalysis("unavailable", false), true);
  assert.equal(blocksNewAnalysis("ready", false), false);
  assert.equal(blocksNewAnalysis("busy", false), false);
  // Unknown state defers to the backend's authoritative check.
  assert.equal(blocksNewAnalysis(null, false), false);
  // An admitted reservation may still upload; it will wait in the queue.
  assert.equal(blocksNewAnalysis("unavailable", true), false);
});

test("only the backend's structured outage error counts as unavailable", () => {
  assert.equal(
    isAnalysisServiceUnavailable({ status: 503, code: "analysis_service_unavailable" }),
    true,
  );
  // Same status, different cause (e.g. allowance not configured).
  assert.equal(isAnalysisServiceUnavailable({ status: 503, code: "http_error" }), false);
  assert.equal(isAnalysisServiceUnavailable(new Error("offline")), false);
  assert.equal(isAnalysisServiceUnavailable(null), false);
});

test("upload screen copy covers ready, busy and unavailable", () => {
  assert.deepEqual(serviceAvailabilityCopy("ready"), {
    title: "Analysis ready",
    description: "A worker is available and your analysis should start shortly.",
  });
  assert.equal(serviceAvailabilityCopy("busy").title, "Analysis service online");
  assert.deepEqual(serviceAvailabilityCopy("unavailable"), {
    title: "Video analysis is temporarily unavailable",
    description: "The analysis service is currently offline. Please try again shortly.",
  });
  assert.equal(serviceAvailabilityCopy(null), null);
});

test("queued copy shows a count, next-in-line, or the safe fallback", () => {
  assert.deepEqual(analysisProgressCopy("queued", "queued", queue("busy", 2)), {
    title: "Your analysis is queued",
    description: "2 analyses ahead of you.",
  });
  assert.equal(
    analysisProgressCopy("queued", "queued", queue("busy", 1)).description,
    "1 analysis ahead of you.",
  );
  assert.deepEqual(analysisProgressCopy("queued", "queued", queue("ready", 0)), {
    title: "Your analysis is next",
    description: "Waiting for the analysis worker.",
  });
  // No reliable position: no number is invented.
  assert.deepEqual(analysisProgressCopy("queued", "queued", queue("busy", null)), {
    title: "Your analysis is queued",
    description: "We’ve received your video and it’s waiting to be processed.",
  });
  assert.equal(
    analysisProgressCopy("queued", "queued").title,
    "Your analysis is queued",
  );
});

test("a queued analysis stays reassuring while the service is offline", () => {
  const copy = analysisProgressCopy("queued", "queued", queue("unavailable", 3));
  assert.equal(copy.title, "Your analysis is safely queued");
  assert.match(copy.description, /remain queued/);
  assert.doesNotMatch(copy.description, /ahead/);
});

test("processing shows progress, or waits for the service if its worker vanished", () => {
  assert.deepEqual(analysisProgressCopy("running", "processing_started", queue("busy")), {
    title: "Your analysis is in progress",
    description: "Your video is being analyzed.",
  });
  assert.equal(
    analysisProgressCopy("running", "rep_completed", queue("busy")).title,
    "Analyzing your movement",
  );
  assert.equal(
    analysisProgressCopy("running", "rep_completed", queue("unavailable")).title,
    "Waiting for analysis service",
  );
  // Terminal states ignore any stale queue snapshot.
  assert.equal(
    analysisProgressCopy("completed", "completed", queue("unavailable")).title,
    "Your results are ready",
  );
  assert.equal(
    analysisProgressCopy("failed", "failed", queue("unavailable")).title,
    "Analysis could not be completed",
  );
});

test("athlete copy never mentions worker internals", () => {
  const all = [
    ...["ready", "busy", "unavailable"].map(serviceAvailabilityCopy),
    ...[null, 0, 4].flatMap((ahead) =>
      ["ready", "busy", "unavailable"].map((state) =>
        analysisProgressCopy("queued", "queued", queue(state, ahead)),
      ),
    ),
    analysisProgressCopy("running", "processing_started", queue("unavailable")),
  ];
  for (const copy of all) {
    assert.doesNotMatch(
      `${copy.title} ${copy.description}`,
      /\bleases?\b|heartbeat|worker id|\bminutes?\b|\bseconds?\b|\bETA\b/i,
    );
  }
});

test("queue payloads are validated and reduced to the safe fields", () => {
  assert.deepEqual(
    parseAnalysisQueue({ service_state: "busy", analyses_ahead: 2, worker_id: "w-1" }),
    { service_state: "busy", analyses_ahead: 2 },
  );
  assert.deepEqual(parseAnalysisQueue({ service_state: "ready", analyses_ahead: -1 }), {
    service_state: "ready",
    analyses_ahead: null,
  });
  assert.deepEqual(parseAnalysisQueue({ service_state: "ready", analyses_ahead: 1.5 }), {
    service_state: "ready",
    analyses_ahead: null,
  });
  assert.equal(parseAnalysisQueue({ service_state: "offline" }), null);
  assert.equal(parseAnalysisQueue(null), null);
});
