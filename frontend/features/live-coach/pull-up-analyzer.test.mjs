import assert from "node:assert/strict";
import test from "node:test";

import { selectPrioritizedCue } from "./cues.ts";
import { pullUpLandmarkFixture } from "./fixtures/pull-up-landmarks.ts";
import { LivePullUpAnalyzer } from "./pull-up-analyzer.ts";
import { measurePullUpPose } from "./pull-up-semantics.ts";

function observation(timestampMs, angleDeg, overrides = {}) {
  return {
    timestampMs,
    angleDeg,
    bodyRelativeY: angleDeg >= 145 ? 0.3 : angleDeg <= 50 ? 0.08 : 0.2,
    faceToWristY: angleDeg <= 50 ? -0.02 : 0.15,
    minimumVisibility: 0.99,
    handsAboveShoulders: true,
    bodyUnderHands: true,
    ...overrides,
  };
}

function feed(analyzer, samples) {
  let snapshot;
  for (const [timestampMs, angleDeg, overrides] of samples) {
    snapshot = analyzer.update(
      observation(timestampMs, angleDeg, overrides),
      timestampMs,
    );
  }
  return snapshot;
}

const confirmedBottom = [
  [0, 150],
  [100, 150],
  [200, 150],
  [300, 150],
  [400, 150],
];

const fullRep = [
  ...confirmedBottom,
  [500, 130],
  [600, 120],
  [700, 45],
  [800, 45],
  [900, 45],
  [1000, 80],
  [1100, 100],
  [1200, 150],
  [1300, 150],
  [1400, 150],
];

test("golden MediaPipe fixtures preserve the Python elbow-angle semantics", () => {
  const bottom = measurePullUpPose(
    pullUpLandmarkFixture({ elbowAngleDeg: 150 }),
    0,
  );
  const top = measurePullUpPose(
    pullUpLandmarkFixture({ elbowAngleDeg: 45, mouthY: 0.12 }),
    100,
  );

  assert.ok(bottom);
  assert.ok(top);
  assert.ok(Math.abs(bottom.angleDeg - 150) < 0.001);
  assert.ok(Math.abs(top.angleDeg - 45) < 0.001);
  assert.equal(bottom.handsAboveShoulders, true);
  assert.ok(top.faceToWristY < 0);
});

test("a stable bottom-rising-top-lowering-bottom cycle counts one rep", () => {
  const analyzer = new LivePullUpAnalyzer();
  const snapshot = feed(analyzer, fullRep);

  assert.equal(snapshot.validRepCount, 1);
  assert.equal(snapshot.phase, "bottom");
  assert.equal(snapshot.latestRep.outcome, "valid");
  assert.deepEqual(snapshot.latestRep.phases, [
    "bottom",
    "rising",
    "top",
    "lowering",
    "bottom",
  ]);
});

test("an incomplete attempt does not increment completed reps", () => {
  const analyzer = new LivePullUpAnalyzer();
  const snapshot = feed(analyzer, [
    ...confirmedBottom,
    [500, 125],
    [600, 110],
    [700, 80],
    [800, 80],
    [900, 80],
    [1000, 150],
    [1100, 150],
    [1200, 150],
  ]);

  assert.equal(snapshot.validRepCount, 0);
  assert.equal(snapshot.partialRepCount, 1);
  assert.equal(snapshot.latestRep.outcome, "partial");
});

test("bottom-threshold jitter cannot double-count a completed rep", () => {
  const analyzer = new LivePullUpAnalyzer();
  feed(analyzer, fullRep);
  const snapshot = feed(analyzer, [
    [1500, 144, { bodyRelativeY: 0.3 }],
    [1600, 146, { bodyRelativeY: 0.3 }],
    [1700, 143, { bodyRelativeY: 0.3 }],
    [1800, 147, { bodyRelativeY: 0.3 }],
    [1900, 150, { bodyRelativeY: 0.3 }],
  ]);

  assert.equal(snapshot.validRepCount, 1);
  assert.equal(snapshot.partialRepCount, 0);
});

test("the prioritized selector emits only the highest-value cue", () => {
  const partialSnapshot = {
    phase: "bottom",
    validRepCount: 0,
    partialRepCount: 1,
    poseReady: true,
    setupReady: true,
    observation: observation(0, 150),
    latestRep: {
      index: 1,
      outcome: "partial",
      startMs: 0,
      topMs: null,
      endMs: 1000,
      phases: ["bottom", "rising", "bottom"],
      reasonCodes: ["did_not_reach_top"],
    },
  };
  assert.equal(selectPrioritizedCue(partialSnapshot).id, "finish-top");

  const lostTracking = { ...partialSnapshot, poseReady: false, setupReady: false };
  assert.equal(selectPrioritizedCue(lostTracking).id, "frame-body");
  assert.ok(
    selectPrioritizedCue(lostTracking).priority >
      selectPrioritizedCue(partialSnapshot).priority,
  );
});

