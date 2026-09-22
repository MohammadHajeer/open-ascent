import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { comparableMetric, trendEmptyCopy } from "./presentation.ts";

const viewSource = readFileSync(new URL("./progress-view.tsx", import.meta.url), "utf8");

test("consistency cards and metric label are rendered", () => {
  assert.match(viewSource, /Workouts this week/);
  assert.match(viewSource, /Active training days/);
  assert.match(viewSource, /Sets logged/);
  assert.match(viewSource, /Metric/);
});

test("movement selection uses the shadcn Select and handles nullable values", () => {
  assert.match(viewSource, /from "@\/components\/ui\/select"/);
  assert.match(viewSource, /<Select/);
  assert.match(viewSource, /value \?\? null/);
  assert.doesNotMatch(viewSource, /<select[\s>]/);
});

test("a multi-point comparable metric can render the line chart", () => {
  const metric = comparableMetric({
    id: "pull-up",
    name: "Pull-Up",
    metrics: [
      { measurement: "hold_seconds", label: "Hold duration", unit: "seconds", points: [] },
      {
        measurement: "reps",
        label: "Reps",
        unit: "reps",
        points: [
          { recorded_at: "2026-09-10T10:00:00Z", value: 6 },
          { recorded_at: "2026-09-14T10:00:00Z", value: 8 },
        ],
      },
    ],
  });
  assert.equal(metric?.measurement, "reps");
  assert.equal(metric?.points.length, 2);
  assert.match(viewSource, /<LineChart/);
  assert.match(viewSource, /chartData\.length < 2/);
});

test("empty and one-point states do not imply a trend", () => {
  assert.match(trendEmptyCopy("Pull-Up", 0).title, /No Pull-Up data/);
  assert.equal(
    trendEmptyCopy("Pull-Up", 1).description,
    "Log another Pull-Up set to start seeing a trend.",
  );
});
