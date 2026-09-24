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

test("a fast valid rep counts when the top is visible in only one frame", () => {
  const analyzer = new LivePullUpAnalyzer();
  const snapshot = feed(analyzer, [
    ...confirmedBottom,
    [480, 110],
    [560, 45],
    [640, 95],
    [720, 150],
  ]);
  assert.equal(snapshot.validRepCount, 1);
  assert.equal(snapshot.latestRep.topMs, 560);
  assert.deepEqual(snapshot.latestRep.phases, ["bottom", "rising", "top", "lowering", "bottom"]);
});

test("multiple fast reps count once each", () => {
  const analyzer = new LivePullUpAnalyzer();
  const snapshot = feed(analyzer, [
    ...confirmedBottom,
    [480, 110], [560, 45], [640, 150],
    [720, 110], [800, 45], [880, 150],
    [960, 110], [1040, 45], [1120, 150],
    [1200, 150], [1280, 146],
  ]);
  assert.equal(snapshot.validRepCount, 3);
  assert.equal(snapshot.latestRep.index, 3);
});

test("low FPS can count a bottom-top-bottom sequence without intermediate phases", () => {
  const analyzer = new LivePullUpAnalyzer();
  const snapshot = feed(analyzer, [
    ...confirmedBottom,
    [620, 45],
    [840, 150],
  ]);
  assert.equal(snapshot.validRepCount, 1);
  assert.deepEqual(snapshot.latestRep.phases, ["bottom", "rising", "top", "lowering", "bottom"]);
});

test("an incomplete fast attempt and a flexion without body rise do not count", () => {
  const analyzer = new LivePullUpAnalyzer();
  const snapshot = feed(analyzer, [
    ...confirmedBottom,
    [480, 80], [560, 150],
    [640, 45, { bodyRelativeY: 0.3 }],
    [720, 150],
  ]);
  assert.equal(snapshot.validRepCount, 0);
  assert.equal(snapshot.partialRepCount, 1);
});

test("a brief tracking gap preserves a rep; a longer gap requires a new hang", () => {
  const brief = new LivePullUpAnalyzer();
  feed(brief, [...confirmedBottom, [480, 110]]);
  brief.update(null, 530);
  brief.update(null, 610);
  assert.equal(feed(brief, [[630, 45], [710, 150]]).validRepCount, 1);

  const long = new LivePullUpAnalyzer();
  feed(long, [...confirmedBottom, [480, 110]]);
  long.update(null, 530);
  long.update(null, 700);
  const snapshot = feed(long, [[780, 45], [860, 150]]);
  assert.equal(snapshot.validRepCount, 0);
  assert.equal(snapshot.phase, "unknown");
});

test("a top without return to the starting height does not count", () => {
  const analyzer = new LivePullUpAnalyzer();
  const snapshot = feed(analyzer, [
    ...confirmedBottom,
    [480, 45],
    [560, 150, { bodyRelativeY: 0.15 }],
  ]);
  assert.equal(snapshot.validRepCount, 0);
});

test("a lone top-angle spike without enough upward travel does not count", () => {
  const analyzer = new LivePullUpAnalyzer();
  const snapshot = feed(analyzer, [
    ...confirmedBottom,
    [480, 45, { bodyRelativeY: 0.28 }],
    [560, 150],
  ]);
  assert.equal(snapshot.validRepCount, 0);
});

test("setup, tracking, and rep-result cues reflect evidence and expire", () => {
  const analyzer = new LivePullUpAnalyzer();
  assert.equal(selectPrioritizedCue(analyzer.update(null, 0, false)).id, "frame-body");
  assert.equal(selectPrioritizedCue(analyzer.update(null, 100, true)).id, "tracking-unusable");
  assert.equal(selectPrioritizedCue(analyzer.update(observation(200, 120), 200)).id, "hold-start");
  const snapshot = feed(analyzer, fullRep.map(([time, angle, overrides]) => [time + 300, angle, overrides]));
  assert.equal(selectPrioritizedCue(snapshot, 1700).id, "rep-complete");
  assert.equal(selectPrioritizedCue(snapshot, 5000).id, "ready");
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
