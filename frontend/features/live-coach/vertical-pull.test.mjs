import assert from "node:assert/strict";
import test from "node:test";

import { selectPrioritizedCue } from "./cues.ts";
import { pullUpLandmarkFixture } from "./fixtures/pull-up-landmarks.ts";
import { LiveVerticalPullAnalyzer, classifyCompletedVerticalPullRep } from "./vertical-pull-analyzer.ts";
import { classifyHandWidth, classifyPoseGrip } from "./pull-up-semantics.ts";
import { LIVE_VERTICAL_PULL_MOVEMENTS } from "./vertical-pull-config.ts";

function sample(at, angle, fields = {}) {
  return {
    timestampMs: at,
    angleDeg: angle,
    bodyRelativeY: angle >= 145 ? 0.3 : angle <= 50 ? 0.08 : 0.2,
    faceToWristY: angle <= 50 ? -0.02 : 0.15,
    minimumVisibility: 0.99,
    handsAboveShoulders: true,
    bodyUnderHands: true,
    motionReady: true,
    grip: "pronated",
    width: "standard",
    upperTorsoToWristRatio: angle <= 50 ? 0.5 : 0.9,
    ...fields,
  };
}

function feed(analyzer, frames) {
  let result;
  for (const [at, angle, fields] of frames) result = analyzer.update(sample(at, angle, fields), at);
  return result;
}

const bottom = [[0, 150], [100, 150], [200, 150], [300, 150], [400, 150]];

function oneRep(fields = {}, topFields = {}) {
  const analyzer = new LiveVerticalPullAnalyzer();
  const result = feed(analyzer, [
    ...bottom.map(([at, angle]) => [at, angle, fields]),
    [500, 110, fields],
    [580, 45, { ...fields, ...topFields }],
    [660, 150, fields],
  ]);
  return result;
}

test("Vertical Pull exposes exactly five canonical classifications and an unknown bucket", () => {
  assert.deepEqual(LIVE_VERTICAL_PULL_MOVEMENTS.map((item) => item.slug), [
    "pull-up", "chin-up", "close-grip-pull-up", "wide-grip-pull-up", "high-pull-up",
  ]);
  assert.equal(oneRep().latestRep.classification.variant, "pull-up");
  assert.equal(oneRep({ grip: "supinated" }).latestRep.classification.variant, "chin-up");
  assert.equal(oneRep({ width: "close" }).latestRep.classification.variant, "close-grip-pull-up");
  assert.equal(oneRep({ width: "wide" }).latestRep.classification.variant, "wide-grip-pull-up");
  const high = oneRep({}, { upperTorsoToWristRatio: 0.02, bodyRelativeY: -0.05,
    handsAboveShoulders: false, bodyUnderHands: false });
  assert.equal(high.latestRep.classification.variant, "high-pull-up");
  assert.equal(high.validRepCount, 1);
  assert.equal(high.latestRep.classification.height, "high");
});

test("one family session counts mixed reps and maintains a per-variant breakdown", () => {
  const analyzer = new LiveVerticalPullAnalyzer();
  feed(analyzer, bottom);
  let at = 480;
  const cases = [
    { grip: "pronated", width: "standard" },
    { grip: "pronated", width: "wide" },
    { grip: "supinated", width: "standard" },
    { grip: "pronated", width: "standard", high: true },
    { grip: "unknown", width: "standard" },
  ];
  for (const item of cases) {
    const common = { grip: item.grip, width: item.width };
    feed(analyzer, [[at, 150, common], [at + 80, 150, common], [at + 160, 150, common]]);
    const highFields = item.high ? { upperTorsoToWristRatio: 0.02,
      bodyRelativeY: -0.05, handsAboveShoulders: false, bodyUnderHands: false } : {};
    const result = feed(analyzer, [[at + 240, 110, common],
      [at + 320, 45, { ...common, ...highFields }], [at + 400, 150, common]]);
    assert.equal(result.validRepCount, cases.indexOf(item) + 1);
    at += 480;
  }
  const result = analyzer.getSnapshot();
  assert.equal(result.validRepCount, 5);
  assert.deepEqual(result.variantBreakdown, {
    "pull-up": 1, "chin-up": 1, "close-grip-pull-up": 0,
    "wide-grip-pull-up": 1, "high-pull-up": 1, unknown: 1,
  });
  assert.equal(result.latestRep.classification.variant, "unknown");
});

test("noisy or insufficient grip and width evidence stays unknown rather than flickering", () => {
  const good = Array.from({ length: 5 }, () => ({ grip: "supinated", width: "standard" }));
  good[2] = { grip: "pronated", width: "standard" };
  assert.equal(classifyCompletedVerticalPullRep(good, [0.5]).variant, "chin-up");
  assert.equal(classifyCompletedVerticalPullRep([
    { grip: "pronated", width: "standard" },
    { grip: "supinated", width: "standard" },
    { grip: "pronated", width: "standard" },
    { grip: "supinated", width: "standard" },
  ], [0.5]).variant, "unknown");
  assert.equal(classifyCompletedVerticalPullRep([
    { grip: "unknown", width: "wide" },
    { grip: "unknown", width: "wide" },
    { grip: "unknown", width: "wide" },
  ], [0.5]).variant, "unknown");
  assert.equal(classifyCompletedVerticalPullRep(good, [0.17]).variant, "unknown");
});

test("hand spacing is scaled to shoulders and threshold gaps stay unknown", () => {
  const classify = (shoulderSpan, wristSpan) => {
    const landmarks = pullUpLandmarkFixture({ elbowAngleDeg: 150 });
    landmarks[11].x = 0.5 - shoulderSpan / 2;
    landmarks[12].x = 0.5 + shoulderSpan / 2;
    landmarks[15].x = 0.5 - wristSpan / 2;
    landmarks[16].x = 0.5 + wristSpan / 2;
    return classifyHandWidth(landmarks);
  };
  assert.equal(classify(0.2, 0.14), "close");
  assert.equal(classify(0.3, 0.21), "close");
  assert.equal(classify(0.2, 0.24), "standard");
  assert.equal(classify(0.2, 0.4), "wide");
  assert.equal(classify(0.2, 0.3), "unknown");
  assert.equal(classify(0.04, 0.04), "unknown");
});

test("coarse pose palms require both visible, agreeing hands", () => {
  const landmarks = pullUpLandmarkFixture({ elbowAngleDeg: 150 });
  landmarks[15].x = 0.3; landmarks[16].x = 0.7;
  const shape = (reversed = false) => {
    landmarks[19].x = 0.3 + (reversed ? -0.025 : 0.025);
    landmarks[17].x = 0.3 + (reversed ? 0.025 : -0.025);
    landmarks[20].x = 0.7 + (reversed ? 0.025 : -0.025);
    landmarks[18].x = 0.7 + (reversed ? -0.025 : 0.025);
    for (const index of [17, 18, 19, 20]) landmarks[index].y = 0.05;
  };
  shape();
  assert.equal(classifyPoseGrip(landmarks), "supinated");
  shape(true);
  assert.equal(classifyPoseGrip(landmarks), "pronated");
  landmarks[18].visibility = 0.2;
  assert.equal(classifyPoseGrip(landmarks), "unknown");
});

test("fast high and standard reps count; a single high-height spike outside top is ignored", () => {
  const analyzer = new LiveVerticalPullAnalyzer();
  const result = feed(analyzer, [
    ...bottom,
    [560, 45, { bodyRelativeY: -0.05, upperTorsoToWristRatio: 0.01 }],
    [640, 150],
    [720, 110, { upperTorsoToWristRatio: 0.01 }],
    [800, 45],
    [880, 150],
  ]);
  assert.equal(result.validRepCount, 2);
  assert.equal(result.variantBreakdown["high-pull-up"], 1);
  assert.equal(result.variantBreakdown["pull-up"], 1);
});

test("reset clears total, breakdown, and in-progress classification", () => {
  const analyzer = new LiveVerticalPullAnalyzer();
  feed(analyzer, [...bottom, [500, 45], [600, 150]]);
  analyzer.reset();
  const result = analyzer.getSnapshot();
  assert.equal(result.validRepCount, 0);
  assert.equal(result.phase, "unknown");
  assert.equal(Object.values(result.variantBreakdown).reduce((a, b) => a + b), 0);
});

test("sustained incomplete extension cues; normal and single noisy frames do not", () => {
  const analyzer = new LiveVerticalPullAnalyzer();
  let result = feed(analyzer, [[0, 130], [100, 130], [200, 130]]);
  assert.equal(selectPrioritizedCue(result).id, "extend-at-bottom");
  analyzer.reset();
  result = feed(analyzer, [[0, 150], [100, 130], [200, 150]]);
  assert.notEqual(selectPrioritizedCue(result).id, "extend-at-bottom");
});

test("sustained deep knee bend cues; normal and single noisy frames do not", () => {
  const analyzer = new LiveVerticalPullAnalyzer();
  feed(analyzer, bottom);
  let result = feed(analyzer, [[500, 150, { kneeAngleDeg: 130 }],
    [600, 150, { kneeAngleDeg: 130 }], [700, 150, { kneeAngleDeg: 130 }]]);
  assert.equal(selectPrioritizedCue(result).id, "excessive-knee-bend");
  analyzer.reset();
  feed(analyzer, bottom);
  result = feed(analyzer, [[500, 150, { kneeAngleDeg: 170 }],
    [600, 150, { kneeAngleDeg: 130 }], [700, 150, { kneeAngleDeg: 170 }]]);
  assert.notEqual(selectPrioritizedCue(result).id, "excessive-knee-bend");
});

test("sustained lower-body reversal cues swing; a one-frame spike does not", () => {
  const analyzer = new LiveVerticalPullAnalyzer();
  feed(analyzer, bottom);
  const path = [0, 0.15, 0.35, 0.32, 0.1, -0.1];
  let result = feed(analyzer, path.map((value, i) => [500 + i * 100, 150,
    { hipHorizontalRatio: value, ankleHorizontalRatio: value }]));
  assert.equal(selectPrioritizedCue(result).id, "body-swing");
  analyzer.reset();
  feed(analyzer, bottom);
  result = feed(analyzer, [0, 0, 0.8, 0, 0, 0].map((value, i) => [500 + i * 100, 150,
    { hipHorizontalRatio: value, ankleHorizontalRatio: value }]));
  assert.notEqual(selectPrioritizedCue(result).id, "body-swing");
});
