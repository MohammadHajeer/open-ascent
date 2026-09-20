import assert from "node:assert/strict";
import test from "node:test";

import { classificationLabels, targetRelation, variationDistribution } from "./rep-classification.ts";

const closeHigh = { rep_index: 1, outcome: "valid", variations: {
  base_movement: "pull_up", grip_width: "close", pull_height: "high",
}, target_match: true, target_deviations: [] };

test("valid close + high rep matches close target while showing its additional variation", () => {
  assert.equal(classificationLabels(closeHigh).height, "High pull");
  assert.match(targetRelation(closeHigh, false, "close-grip-pull-up"), /Matches target.*high-pull variation/);
  assert.equal(targetRelation(closeHigh, true), null);
});

test("valid target deviation is visually distinct from validity", () => {
  const wide = { ...closeHigh, variations: { ...closeHigh.variations, grip_width: "wide" }, target_match: false };
  assert.equal(wide.outcome, "valid");
  assert.equal(targetRelation(wide, false, "close-grip-pull-up"), "Does not match selected target");
  assert.deepEqual(variationDistribution([closeHigh, wide]), [
    "1 × Pull-Up · Close grip · High pull", "1 × Pull-Up · Wide grip · High pull",
  ]);
});
