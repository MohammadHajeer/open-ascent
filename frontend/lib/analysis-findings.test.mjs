import assert from "node:assert/strict";
import test from "node:test";

import { describeReason, detectedGrip, detectedMovement, strongestFindings } from "./analysis-findings.ts";

test("findings rank recorded reason codes without inventing explanations", () => {
  const result = {
    reps: [
      { reason_codes: ["did_not_reach_top"], variations: {} },
      { reason_codes: ["did_not_reach_top"], variations: {} },
      { reason_codes: ["tracking_lost"], variations: {} },
    ],
    evidence: { reason_codes: ["low_usable_pose_ratio"] },
  };
  const findings = strongestFindings(result);
  assert.equal(findings[0].headline, "Top position not reached");
  assert.equal(findings[0].count, 2);
  assert.equal(describeReason("unrecognized_code"), null);
});

test("movement and grip remain uncertain when per-rep evidence is absent", () => {
  const uncertain = [{ variations: { movement: "uncertain", grip_orientation: "uncertain" } }];
  assert.equal(detectedMovement(uncertain), "Uncertain");
  assert.equal(detectedGrip(uncertain), "Uncertain");

  const mixed = [
    { variations: { movement: "pull_up", grip_orientation: "pronated" } },
    { variations: { movement: "chin_up", grip_orientation: "supinated" } },
  ];
  assert.equal(detectedMovement(mixed), "Mixed grip evidence");
  assert.equal(detectedGrip(mixed), "Mixed");
});
