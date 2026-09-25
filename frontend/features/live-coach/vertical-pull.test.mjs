import assert from "node:assert/strict";
import test from "node:test";

import { selectPrioritizedCue } from "./cues.ts";
import { pullUpLandmarkFixture } from "./fixtures/pull-up-landmarks.ts";
import { LiveVerticalPullAnalyzer, classifyCompletedVerticalPullRep } from "./vertical-pull-analyzer.ts";
import { classifyHandWidth, classifyPoseGrip, handWidthRatio, measurePullUpPose } from "./pull-up-semantics.ts";
import { LIVE_VERTICAL_PULL_MOVEMENTS, verticalPullVariantLabel } from "./vertical-pull-config.ts";

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
    "wide-grip-pull-up": 1, "high-pull-up": 1,
    "close-vertical-pull": 0, "wide-vertical-pull": 0,
    "high-vertical-pull": 0, "standard-width-vertical-pull": 1,
    "standard-height-vertical-pull": 0, unknown: 0,
  });
  assert.equal(result.latestRep.classification.variant, "standard-width-vertical-pull");
});

test("noisy or insufficient attributes keep their independent evidence", () => {
  const good = Array.from({ length: 5 }, () => ({ grip: "supinated", width: "standard" }));
  good[2] = { grip: "pronated", width: "standard" };
  assert.equal(classifyCompletedVerticalPullRep(good, [0.5]).variant, "chin-up");
  assert.equal(classifyCompletedVerticalPullRep([
    { grip: "pronated", width: "standard" },
    { grip: "supinated", width: "standard" },
    { grip: "pronated", width: "standard" },
    { grip: "supinated", width: "standard" },
  ], [0.5]).variant, "standard-width-vertical-pull");
  assert.equal(classifyCompletedVerticalPullRep([
    { grip: "unknown", width: "wide" },
    { grip: "unknown", width: "wide" },
    { grip: "unknown", width: "wide" },
  ], [0.5]).variant, "wide-vertical-pull");
  assert.equal(classifyCompletedVerticalPullRep(good, [0.17]).variant, "chin-up");
  assert.equal(classifyCompletedVerticalPullRep([
    { grip: "unknown", width: "unknown" },
    { grip: "unknown", width: "unknown" },
  ], []).variant, "unknown");
  assert.equal(classifyCompletedVerticalPullRep([
    { grip: "unknown", width: "unknown" },
    { grip: "unknown", width: "unknown" },
  ], [0.4]).variant, "standard-height-vertical-pull");
  assert.equal(classifyCompletedVerticalPullRep([
    { grip: "unknown", width: "standard" },
    { grip: "unknown", width: "standard" },
  ], [0.02]).variant, "high-vertical-pull");
  assert.equal(classifyCompletedVerticalPullRep([
    { grip: "pronated", width: "unknown" },
    { grip: "pronated", width: "unknown" },
  ], []).variant, "pull-up");
  assert.equal(verticalPullVariantLabel("wide-vertical-pull"), "Wide Vertical Pull");
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
  assert.equal(classify(0.2, 0.31), "unknown");
  assert.equal(classify(0.04, 0.04), "unknown");
});

test("noisy landmark width sequences keep close, standard, and wide apart across scale", () => {
  for (const [expected, baseline] of [
    ["close", 0.76], ["standard", 1.22], ["wide", 1.82],
  ]) {
    const observed = [];
    for (const [scale, jitter] of [[0.7, -0.03], [1, 0.02], [1.3, 0], [0.85, 0.04]]) {
      const landmarks = pullUpLandmarkFixture({ elbowAngleDeg: 150 });
      const shoulderSpan = 0.24 * scale;
      const wristSpan = shoulderSpan * (baseline + jitter);
      landmarks[11].x = 0.5 - shoulderSpan / 2;
      landmarks[12].x = 0.5 + shoulderSpan / 2;
      landmarks[15].x = 0.5 - wristSpan / 2;
      landmarks[16].x = 0.5 + wristSpan / 2;
      landmarks[23].y = landmarks[11].y + 0.22 * scale;
      landmarks[24].y = landmarks[12].y + 0.22 * scale;
      assert.ok(Math.abs(handWidthRatio(landmarks) - (baseline + jitter)) < 1e-8);
      observed.push(classifyHandWidth(landmarks));
    }
    assert.deepEqual(observed, [expected, expected, expected, expected]);
  }
});

test("mirror display coordinates do not change width or upper-torso height evidence", () => {
  const landmarks = pullUpLandmarkFixture({ elbowAngleDeg: 45 });
  landmarks[11].y = 0.10;
  landmarks[12].y = 0.10;
  landmarks[23].y = 0.32;
  landmarks[24].y = 0.32;
  const mirrored = landmarks.map((item) => ({ ...item, x: 1 - item.x }));
  const first = measurePullUpPose(landmarks, 0);
  const second = measurePullUpPose(mirrored, 0);
  assert.ok(first && second);
  assert.ok(first.upperTorsoToWristRatio <= 0.05);
  assert.equal(first.upperTorsoToWristRatio, second.upperTorsoToWristRatio);
  assert.equal(first.width, second.width);
  assert.equal(first.grip, "unknown");
  assert.equal(second.grip, "unknown");
});

test("upper-torso height ratio survives normal camera-distance changes", () => {
  const landmarks = pullUpLandmarkFixture({ elbowAngleDeg: 45 });
  landmarks[11].y = 0.10;
  landmarks[12].y = 0.10;
  landmarks[23].y = 0.32;
  landmarks[24].y = 0.32;
  const ratios = [0.35, 0.7, 1.2].map((scale) => {
    const scaled = landmarks.map((item) => ({
      ...item,
      x: 0.5 + (item.x - 0.5) * scale,
      y: 0.5 + (item.y - 0.5) * scale,
    }));
    return measurePullUpPose(scaled, 0).upperTorsoToWristRatio;
  });
  for (const ratio of ratios) assert.ok(Math.abs(ratio - ratios[0]) < 1e-8);
  assert.ok(ratios[0] <= 0.05);
});

test("classification visibility can fail without invalidating count geometry", () => {
  const landmarks = pullUpLandmarkFixture({ elbowAngleDeg: 150 });
  landmarks[15].visibility = 0.52;
  landmarks[15].presence = 0.52;
  const observation = measurePullUpPose(landmarks, 0);
  assert.ok(observation);
  assert.equal(observation.width, "unknown");
  assert.equal(observation.widthRatio, null);
  assert.ok(observation.angleDeg > 145);
});

test("missing and jittery width frames do not erase a counted fast rep", () => {
  const analyzer = new LiveVerticalPullAnalyzer();
  const widths = ["wide", "wide", "unknown", "wide", "standard", "wide", "wide"];
  const frames = [
    ...bottom.map(([at, angle], index) => [at, angle, { grip: "unknown", width: widths[index],
      widthRatio: widths[index] === "unknown" ? null : widths[index] === "wide" ? 1.78 : 1.49 }]),
    [500, 110, { grip: "unknown", width: widths[5], widthRatio: 1.76 }],
    [580, 45, { grip: "unknown", width: widths[6], widthRatio: 1.79 }],
    [660, 150, { grip: "unknown", width: "unknown", widthRatio: null }],
  ];
  const result = feed(analyzer, frames);
  assert.equal(result.validRepCount, 1);
  assert.equal(result.latestRep.classification.variant, "wide-vertical-pull");
  assert.equal(result.latestRep.classification.grip, "unknown");
  assert.equal(result.latestRep.classification.width, "wide");
  assert.ok(analyzer.getClassificationDiagnostics().widthVotes.wide >
    analyzer.getClassificationDiagnostics().widthVotes.standard);

  const absent = oneRep({ grip: "unknown", width: "unknown" },
    { upperTorsoToWristRatio: null });
  assert.equal(absent.validRepCount, 1);
  assert.equal(absent.latestRep.classification.variant, "unknown");
});

test("coarse Pose hand points cannot establish pronation or supination", () => {
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
  assert.equal(classifyPoseGrip(landmarks), "unknown");
  shape(true);
  assert.equal(classifyPoseGrip(landmarks), "unknown");
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

test("a bent-arm hang cues extension only after it persists; settling into the hang does not", () => {
  const bentHang = (until) => Array.from({ length: until / 100 + 1 }, (_, index) => [index * 100, 130]);
  const analyzer = new LiveVerticalPullAnalyzer();
  let result = feed(analyzer, bentHang(800));
  assert.notEqual(selectPrioritizedCue(result).id, "extend-at-bottom");
  result = feed(analyzer, [[900, 130], [1000, 130]]);
  assert.equal(selectPrioritizedCue(result).id, "extend-at-bottom");
  analyzer.reset();
  result = feed(analyzer, [[0, 130], [100, 130], [200, 130], [300, 150], [1200, 130]]);
  assert.notEqual(selectPrioritizedCue(result).id, "extend-at-bottom");
});

test("lowering after a tracking reset does not trigger an extension cue", () => {
  const analyzer = new LiveVerticalPullAnalyzer();
  feed(analyzer, [...bottom, [480, 110], [560, 45]]);
  analyzer.update(null, 640);
  analyzer.update(null, 800);
  // Three bent-arm frames over 160 ms: a normal descent, not a bent-arm hang.
  const result = feed(analyzer, [[880, 80], [960, 100], [1040, 130]]);
  assert.equal(result.phase, "unknown");
  assert.notEqual(selectPrioritizedCue(result).id, "extend-at-bottom");
});

test("knee position alone never produces a form cue", () => {
  const analyzer = new LiveVerticalPullAnalyzer();
  const bent = { kneeAngleDeg: 100 };
  const result = feed(analyzer, [...bottom.map(([at, angle]) => [at, angle, bent]),
    [500, 110, bent], [580, 45, bent], [660, 150, bent], [760, 150, bent], [860, 150, bent]]);
  assert.equal(result.validRepCount, 1);
  assert.equal(result.formFault, null);
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
