import assert from "node:assert/strict";
import test from "node:test";

import {
  confidenceLevel,
  initials,
  label,
  startingValue,
  trainingDays,
} from "./presentation.ts";

test("label title-cases snake case and reports missing values plainly", () => {
  assert.equal(label("pull_up_bar"), "Pull Up Bar");
  assert.equal(label(undefined), "Not provided");
  assert.equal(label("", "—"), "—");
});

test("initials use the first and last word and never come back empty", () => {
  assert.equal(initials("Maya Okafor"), "MO");
  assert.equal(initials("  ada   king  lovelace "), "AL");
  assert.equal(initials("Prince"), "P");
  assert.equal(initials(""), "OA");
  assert.equal(initials(undefined), "OA");
});

test("confidence maps only the known levels", () => {
  assert.equal(confidenceLevel("low"), 1);
  assert.equal(confidenceLevel("Medium"), 2);
  assert.equal(confidenceLevel("HIGH"), 3);
  assert.equal(confidenceLevel("certain"), null);
  assert.equal(confidenceLevel(undefined), null);
});

test("training days clamp to a week and ignore non-numbers", () => {
  assert.equal(trainingDays(4), 4);
  assert.equal(trainingDays(12), 7);
  assert.equal(trainingDays(-1), 0);
  assert.equal(trainingDays(undefined), null);
  assert.equal(trainingDays(Number.NaN), null);
});

test("starting value matches slugs regardless of separator style", () => {
  const baseline = { pull_up: 8, "push-up": 25 };
  assert.equal(startingValue("pull-up", baseline), 8);
  assert.equal(startingValue("push_up", baseline), 25);
  assert.equal(startingValue("dip", baseline), undefined);
  assert.equal(startingValue(undefined, baseline), undefined);
  assert.equal(startingValue("pull-up", undefined), undefined);
});
