import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { completedDuration, elapsedSeconds, formatElapsed } from "./duration.ts";
import { isStaleSession, resolveSessionRecovery } from "./recovery.ts";

const session = (id, started_at, completed_at = null) => ({
  id,
  started_at,
  completed_at,
  set_count: 0,
});

test("elapsed timer derives from persisted start after a reload", () => {
  const startedAt = "2026-09-22T10:00:00Z";
  assert.equal(elapsedSeconds(startedAt, Date.parse("2026-09-22T10:18:42Z")), 1122);
  assert.equal(formatElapsed(1122), "00:18:42");
  assert.equal(elapsedSeconds(startedAt, Date.parse("2026-09-22T11:01:00Z")), 3660);
  assert.equal(formatElapsed(3660), "01:01:00");
  assert.equal(completedDuration(startedAt, "2026-09-22T10:22:15Z"), "22 min");
});

test("one unfinished workout resumes, multiple require an explicit choice", () => {
  const older = session("older", "2026-09-20T10:00:00Z");
  const newer = session("newer", "2026-09-22T10:00:00Z");
  const done = session("done", "2026-09-18T10:00:00Z", "2026-09-18T10:30:00Z");
  assert.equal(resolveSessionRecovery([done, older], null).activeSessionId, "older");
  const ambiguous = resolveSessionRecovery([older, done, newer], null);
  assert.equal(ambiguous.activeSessionId, null);
  assert.equal(ambiguous.recoveryNeeded, true);
  assert.deepEqual(ambiguous.unfinishedSessions.map((item) => item.id), ["newer", "older"]);
  assert.equal(resolveSessionRecovery([older, newer], "older").activeSessionId, "older");
  assert.equal(resolveSessionRecovery([done], null).activeSessionId, null);
});

test("old or previous-day workouts need explicit recovery without becoming completed", () => {
  const today = Date.parse("2026-09-22T15:00:00Z");
  assert.equal(isStaleSession("2026-09-22T14:00:00Z", today), false);
  assert.equal(isStaleSession("2026-09-22T06:00:00Z", today), true);
  assert.equal(isStaleSession("2026-09-21T18:00:00Z", today), true);
  const old = session("old", "2026-09-21T18:00:00Z");
  assert.equal(resolveSessionRecovery([old], null).activeSessionId, "old");
  assert.equal(old.completed_at, null);
});

test("workspace keeps history outside active and start branches", () => {
  const logger = readFileSync(new URL("./workout-logger.tsx", import.meta.url), "utf8");
  assert.match(logger, /<RecentSessions sessions=\{controller\.recentSessions\}/);
  assert.match(logger, /<SessionRecovery/);
  assert.match(logger, /<StaleWorkoutRecovery/);
  const active = readFileSync(new URL("./components/active-workout-view.tsx", import.meta.url), "utf8");
  assert.match(active, /border-b[^\"]*xl:border-r xl:border-b-0/);
  assert.match(active, /<SessionTimer/);
});

test("form uses labelled Base UI controls and contextual finish copy", () => {
  const form = readFileSync(new URL("./components/workout-set-form.tsx", import.meta.url), "utf8");
  const details = readFileSync(new URL("./components/logging-details.tsx", import.meta.url), "utf8");
  const sidebar = readFileSync(new URL("./components/session-sidebar.tsx", import.meta.url), "utf8");
  assert.match(form, /id="workout-movement"/);
  assert.match(form, /id="workout-value"/);
  assert.match(details, /id="workout-source"/);
  assert.match(details, /id="workout-performer"/);
  assert.match(details, /id="workout-intent"/);
  assert.match(sidebar, /Save set & finish/);
  assert.match(sidebar, /Finish workout/);
  assert.doesNotMatch(form + details + sidebar, /<button[\s>]|<select[\s>]/);
});
