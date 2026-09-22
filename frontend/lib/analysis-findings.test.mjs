import assert from "node:assert/strict";
import test from "node:test";

import {
  countMetrics,
  describeReason,
  detectedGrip,
  detectedMovement,
  mechanicalUncertaintySummary,
  resultHeadline,
  strongestFindings,
} from "./analysis-findings.ts";

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

test("zero confirmed reps still reports detected attempts clearly", () => {
  const result = {
    outcome: "zero_valid_reps",
    valid_rep_count: 0,
    partial_rep_count: 0,
    uncertain_rep_count: 2,
    reps: [
      { outcome: "uncertain", reason_codes: ["low_landmark_confidence"] },
      { outcome: "uncertain", reason_codes: ["low_landmark_confidence"] },
    ],
  };

  assert.deepEqual(resultHeadline(result), {
    title: "2 attempts detected.",
    subtitle: "0 could be fully confirmed from pose evidence.",
  });
  assert.deepEqual(countMetrics(result), [
    ["Confirmed reps", "0"],
    ["Partial attempts", "0"],
    ["Uncertain attempts", "2"],
    ["Total attempts", "2"],
  ]);
  assert.equal(
    mechanicalUncertaintySummary(result),
    "2 attempts were detected, but pose-landmark quality was not sufficient to fully validate them.",
  );
});

test("per-attempt landmark wording preserves mechanical uncertainty", () => {
  assert.equal(
    describeReason("low_landmark_confidence"),
    "Pose-landmark evidence was not sufficient to fully validate this attempt.",
  );
});

test("multiple deterministic technique findings from one rep stay visible", () => {
  const result = {
    reps: [
      {
        reason_codes: [],
        technique_findings: [
          "limited_bottom_extension",
          "excessive_knee_bend",
          "leg_separation",
          "swing_detected",
        ],
        variations: {},
      },
    ],
    evidence: { reason_codes: [] },
  };
  const findings = strongestFindings(result);
  assert.equal(findings.length, 3);
  assert.ok(findings.some((item) => item.headline === "Bottom extension limited"));
  assert.ok(findings.some((item) => item.headline === "Knee bend increased"));
  assert.ok(findings.some((item) => item.headline === "Legs separated"));
});
