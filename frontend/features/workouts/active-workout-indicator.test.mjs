import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { clearActiveWorkout, incrementActiveSetCount } from "./active-cache.ts";
import { getActiveWorkoutPresentation } from "./active-presentation.ts";

const session = (started_at, completed_at = null) => ({
  id: "session-1",
  started_at,
  completed_at,
  set_count: 0,
});

test("indicator is absent without an active session and on Train", () => {
  const now = Date.parse("2026-09-22T14:18:42Z");
  assert.equal(getActiveWorkoutPresentation(null, now, "/dashboard"), null);
  assert.equal(getActiveWorkoutPresentation(
    session("2026-09-22T14:00:00Z", "2026-09-22T14:15:00Z"), now, "/dashboard",
  ), null);
  assert.equal(getActiveWorkoutPresentation(
    session("2026-09-22T14:00:00Z"), now, "/dashboard/train",
  ), null);
});

test("normal timer is derived from the persisted start across navigation and reload", () => {
  const active = session("2026-09-22T14:00:00Z");
  const first = getActiveWorkoutPresentation(active, Date.parse("2026-09-22T14:18:42Z"), "/dashboard");
  const reloaded = getActiveWorkoutPresentation(active, Date.parse("2026-09-22T15:01:00Z"), "/analyze");
  assert.equal(first.title, "Workout in progress");
  assert.equal(first.detail, "00:18:42");
  assert.equal(first.action, "Resume");
  assert.equal(first.href, "/dashboard/train");
  assert.equal(reloaded.detail, "01:01:00");
});

test("stale workout switches wording and navigates to Train recovery", () => {
  const presentation = getActiveWorkoutPresentation(
    session("2026-09-21T18:00:00Z"), Date.parse("2026-09-22T15:00:00Z"), "/dashboard/progress",
  );
  assert.equal(presentation.title, "Workout still open");
  assert.equal(presentation.detail, "Started yesterday");
  assert.equal(presentation.action, "Resolve");
  assert.equal(presentation.href, "/dashboard/train");
  assert.doesNotMatch(presentation.detail, /21:00:00/);
});

test("start, set logging, finish and discard update the single active value", () => {
  let active = null;
  assert.equal(getActiveWorkoutPresentation(active, 0, "/dashboard"), null);
  active = session("2026-09-22T14:00:00Z");
  assert.equal(getActiveWorkoutPresentation(active, Date.parse("2026-09-22T14:01:00Z"), "/dashboard")?.title, "Workout in progress");
  active = incrementActiveSetCount(active, active.id);
  assert.equal(active.set_count, 1);
  assert.equal(clearActiveWorkout(active, "another-session"), active);
  active = clearActiveWorkout(active, active.id);
  assert.equal(active, null);
  active = session("2026-09-22T14:00:00Z");
  active = clearActiveWorkout(active, active.id);
  assert.equal(active, null);
});

test("layout placement is scoped to athlete pages and Analyze requires authentication", () => {
  const shell = readFileSync(new URL("../../components/dashboard/dashboard-shell.tsx", import.meta.url), "utf8");
  const analyze = readFileSync(new URL("../../app/(public)/analyze/page.tsx", import.meta.url), "utf8");
  const indicator = readFileSync(new URL("./active-workout-indicator.tsx", import.meta.url), "utf8");
  assert.match(shell, /mode === "user" \? <ActiveWorkoutIndicator/);
  assert.match(analyze, /authenticated \? <ActiveWorkoutIndicator surface="analyze"/);
  assert.match(indicator, /grid-cols-\[minmax\(0,1fr\)_auto\]/);
  assert.match(indicator, /aria-label=\{presentation\.actionLabel\}/);
});
