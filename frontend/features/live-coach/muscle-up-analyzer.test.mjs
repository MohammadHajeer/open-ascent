import assert from "node:assert/strict";
import test from "node:test";

import { selectMuscleUpCue } from "./cues.ts";
import { LiveCoachAnalyzer } from "./live-analyzer.ts";
import { LiveMuscleUpAnalyzer, measureMuscleUpPose } from "./muscle-up-analyzer.ts";
import { LiveVerticalPullAnalyzer } from "./vertical-pull-analyzer.ts";
import { measurePullUpPose } from "./pull-up-semantics.ts";
import { pullUpLandmarkFixture } from "./fixtures/pull-up-landmarks.ts";
import { correctionClip, cueClip, LiveCoachVoice } from "./voice.ts";

// The live loop targets 12 fps, so samples arrive ~83 ms apart.
const LIVE_STEP_MS = 1000 / 12;
const WRIST_Y = 0.3;
const ARM_LENGTH = 0.3;

function harness(stepMs = LIVE_STEP_MS) {
  const analyzer = new LiveMuscleUpAnalyzer();
  let time = -stepMs;
  let snapshot;
  const cues = [];
  // Each sample is [shoulderAboveWrist, elbowAngleDeg] or null (no pose).
  const frame = (sample, overrides = {}) => {
    time += stepMs;
    snapshot = analyzer.update(sample === null ? null : {
      timestampMs: time, shoulderAboveWrist: sample[0], elbowAngleDeg: sample[1],
      wristY: WRIST_Y, armLength: ARM_LENGTH, minimumVisibility: 0.99, side: "left", ...overrides,
    }, time);
    cues.push(selectMuscleUpCue(snapshot, time).id);
    return snapshot;
  };
  const feed = (samples, overrides) => {
    for (const sample of samples) frame(sample, overrides);
    return snapshot;
  };
  return { analyzer, frame, feed, cues, cue: () => selectMuscleUpCue(snapshot, time) };
}

const HANG = [-0.95, 170];
const arm = Array(6).fill(HANG);
const up = [[-0.7, 140], [-0.4, 100], [-0.1, 70], [0.1, 60], [0.25, 60], [0.35, 90], [0.6, 150], [0.85, 170], [0.85, 170]];
const down = [[0.5, 130], [0.1, 90], [-0.3, 100], [-0.7, 150], HANG, HANG];
const muscleUp = [...up, ...down];
// Chin over the bar: shoulders stay below the wrists, elbows deeply bent.
const pullUp = [[-0.7, 140], [-0.5, 100], [-0.3, 60], [-0.25, 50], [-0.25, 50], [-0.4, 90], [-0.7, 140], [-0.9, 165], HANG, HANG];
// Chest to bar: shoulders reach above the wrists, but never straight-arm support.
const highPull = [[-0.7, 140], [-0.4, 90], [-0.1, 60], [0.2, 45], [0.3, 40], [0.3, 40], [0.1, 60], [-0.3, 100], [-0.7, 150], HANG, HANG];

function interpolate(keyframes, stepsPerSegment) {
  const samples = [];
  for (let index = 0; index < keyframes.length - 1; index += 1) {
    const [from, to] = [keyframes[index], keyframes[index + 1]];
    for (let step = 0; step < stepsPerSegment; step += 1) {
      const t = step / stepsPerSegment;
      samples.push([from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t]);
    }
  }
  return [...samples, keyframes.at(-1)];
}

test("one full muscle-up counts once at lockout; the return to the hang only re-arms", () => {
  const h = harness();
  assert.equal(h.feed(arm).phase, "bottom");
  assert.equal(h.cues.at(-1), "muscle-up-ready");
  let snapshot = h.feed(up.slice(0, 6));
  assert.equal(snapshot.validRepCount, 0, "the pull and transition alone never count");
  snapshot = h.feed(up.slice(6));
  assert.equal(snapshot.phase, "top");
  assert.equal(snapshot.validRepCount, 1, "straight-arm support completes the rep");
  assert.deepEqual(snapshot.latestRep.phases, ["bottom", "rising", "transition", "top"]);
  assert.equal(h.cue().id, "muscle-up-rep-complete");
  snapshot = h.feed(down);
  assert.equal(snapshot.validRepCount, 1, "returning to the hang does not count again");
  assert.equal(snapshot.partialRepCount, 0);
  assert.equal(snapshot.phase, "bottom");
  assert.equal(h.cue().id, "muscle-up-rep-complete");
  assert.equal(h.feed(Array(30).fill(HANG)).validRepCount, 1, "staying in the hang never repeats a count");
  assert.equal(h.cue().id, "muscle-up-ready", "the confirmation fades after 2.5 s");
});

test("consecutive muscle-ups each count once", () => {
  const h = harness();
  h.feed(arm);
  let snapshot;
  for (let rep = 1; rep <= 5; rep += 1) {
    snapshot = h.feed(muscleUp);
    assert.equal(snapshot.validRepCount, rep);
  }
  assert.equal(snapshot.partialRepCount, 0);
  assert.equal(snapshot.latestRep.index, 5);
});

test("a normal pull-up never counts and is flagged as a failed attempt", () => {
  const h = harness();
  h.feed(arm);
  const snapshot = h.feed(pullUp);
  assert.equal(snapshot.validRepCount, 0);
  assert.equal(snapshot.partialRepCount, 1);
  assert.ok(!h.cues.includes("muscle-up-transition") && !h.cues.includes("muscle-up-support"));
  assert.equal(h.cue().id, "get-over-bar");
  assert.equal(h.cue().title, "Get over the bar");
});

test("a high chest-to-bar pull reaches the transition but never support, so it does not count", () => {
  const h = harness();
  h.feed(arm);
  const snapshot = h.feed(highPull);
  assert.equal(snapshot.validRepCount, 0);
  assert.equal(snapshot.partialRepCount, 1);
  assert.deepEqual(snapshot.latestRep.phases, ["bottom", "rising", "transition", "bottom"]);
  assert.deepEqual(snapshot.latestRep.reasonCodes, ["did_not_reach_support"]);
  assert.ok(h.cues.includes("muscle-up-transition") && !h.cues.includes("muscle-up-support"));
  assert.equal(h.cue().id, "get-over-bar");
  // The failed attempt does not block the next real rep, which clears the cue.
  assert.equal(h.feed(muscleUp).validRepCount, 1);
  assert.equal(h.cue().id, "muscle-up-rep-complete");
});

test("turning over the bar without pressing out to straight-arm support does not count", () => {
  const h = harness();
  h.feed(arm);
  // Shoulders well above the wrists, but elbows stay bent in a deep dip.
  const snapshot = h.feed([...up.slice(0, 6), [0.55, 80], [0.6, 85], [0.6, 85], [0.3, 80], ...down.slice(1)]);
  assert.equal(snapshot.validRepCount, 0);
  assert.equal(snapshot.partialRepCount, 1);
  assert.ok(!h.cues.includes("muscle-up-support"));
});

test("kip swings and small pulls re-arm silently without a partial or cue", () => {
  const h = harness();
  h.feed(arm);
  // Straight-arm swing: the shoulder arcs around the hands but stays well below.
  h.feed([[-0.8, 168], [-0.7, 165], [-0.8, 168], HANG, [-0.75, 166], HANG, HANG]);
  // A small pull that bends the elbows a little and comes back.
  const snapshot = h.feed([[-0.8, 130], [-0.7, 120], [-0.7, 120], [-0.9, 150], HANG, HANG]);
  assert.equal(snapshot.validRepCount, 0);
  assert.equal(snapshot.partialRepCount, 0);
  assert.equal(snapshot.phase, "bottom");
  assert.ok(!h.cues.includes("get-over-bar"));
});

test("holding, leaving, and re-entering support count once; only a hang re-arms", () => {
  const h = harness();
  assert.equal(h.feed([...arm, ...up, ...Array(40).fill([0.85, 170])]).validRepCount, 1);
  // Dips on top of the bar and presses back to support are not new muscle-ups.
  for (let press = 0; press < 3; press += 1) {
    assert.equal(h.feed(Array(6).fill([0.1, 90])).phase, "lowering");
    const snapshot = h.feed([[0.5, 140], [0.8, 165], [0.85, 170], [0.85, 170]]);
    assert.equal(snapshot.phase, "top");
    assert.equal(snapshot.validRepCount, 1);
  }
  assert.equal(h.feed(down).validRepCount, 1);
  assert.equal(h.feed(Array(10).fill(HANG)).validRepCount, 1);
  assert.equal(h.feed(muscleUp).validRepCount, 2);
});

test("dismounting straight from support keeps the rep and cannot count again", () => {
  const h = harness();
  assert.equal(h.feed([...arm, ...up]).validRepCount, 1);
  // Hands leave the bar: standing looks like support but the wrists are far
  // below the bar, then the athlete walks out of frame.
  let snapshot = h.feed([...Array(12).fill([0.9, 170]), ...Array(10).fill(null)], { wristY: 0.85 });
  assert.equal(snapshot.validRepCount, 1);
  assert.equal(snapshot.partialRepCount, 0);
  assert.equal(snapshot.phase, "unknown");
  // Coming back requires a fresh hang before the next count.
  snapshot = h.feed([...Array(4).fill([0.85, 170]), ...arm, ...muscleUp]);
  assert.equal(snapshot.validRepCount, 2);
  assert.equal(snapshot.partialRepCount, 0);
});

test("noisy shoulder/wrist values around the transition and support lines cause no false state changes", () => {
  const h = harness();
  h.feed(arm);
  // Single-sample hang breaks never start a pull.
  h.feed([HANG, [-0.6, 130], HANG, [-0.4, 150], HANG, HANG]);
  assert.equal(h.cues.includes("muscle-up-pulling"), false);
  // A pull whose shoulder jitters across wrist height, with alternating
  // single-sample "support" readings, never confirms transition or support.
  const snapshot = h.feed([
    [-0.6, 120], [-0.3, 80], [-0.05, 60], [0.05, 60], [-0.05, 60], [0.55, 150], [-0.05, 60],
    [0.55, 150], [-0.05, 60], [0.05, 60], [-0.2, 70], [-0.6, 140], HANG, HANG,
  ]);
  assert.equal(snapshot.validRepCount, 0);
  assert.ok(!h.cues.includes("muscle-up-transition") && !h.cues.includes("muscle-up-support"), h.cues.join(","));
});

test("fast muscle-up with only two samples in support counts at the live cadence", () => {
  const h = harness();
  h.feed(arm);
  const fast = [[-0.5, 120], [0.1, 70], [0.3, 80], [0.7, 160], [0.8, 170], [0.2, 100], [-0.6, 150], [-0.9, 170]];
  assert.equal(h.feed(fast).validRepCount, 1);
  assert.equal(h.feed(fast).validRepCount, 2);
  assert.equal(h.feed(fast).partialRepCount, 0);
});

test("an explosive muscle-up through lockout in one sample counts, without a failed-attempt cue", () => {
  const h = harness();
  h.feed(arm);
  const explosive = [[-0.5, 120], [0.1, 70], [0.3, 80], [0.45, 135], [0.8, 165], [0.4, 130], [-0.2, 100], [-0.7, 150], HANG, HANG];
  for (let rep = 1; rep <= 3; rep += 1) assert.equal(h.feed(explosive).validRepCount, rep);
  assert.equal(h.feed([HANG]).partialRepCount, 0);
  assert.ok(!h.cues.includes("get-over-bar"), h.cues.join(","));
});

test("back-to-back kipping muscle-ups that pass the hang in one sample each count", () => {
  const h = harness();
  h.feed(arm);
  // The straight-arm hang lasts one sample at the bottom of the swing, then the next pull starts.
  const kipping = [[-0.3, 110], [0.1, 65], [0.35, 85], [0.6, 150], [0.85, 168], [0.3, 110], [-0.3, 120], [-0.6, 150], [-0.4, 138]];
  const snapshot = h.feed([...kipping, ...kipping, ...kipping, HANG, HANG]);
  assert.equal(snapshot.validRepCount, 3);
  assert.equal(snapshot.partialRepCount, 0);
});

test("pressing out short of lockout never counts, even quickly", () => {
  const h = harness();
  h.feed(arm);
  // Shoulders reach support height, but the elbows peak at 140°.
  const short = [[-0.5, 120], [0.1, 70], [0.3, 80], [0.5, 130], [0.8, 140], [0.5, 128], [-0.2, 100], [-0.7, 150], HANG, HANG];
  const snapshot = h.feed([...short, ...short]);
  assert.equal(snapshot.validRepCount, 0);
  assert.equal(snapshot.partialRepCount, 2);
  assert.ok(!h.cues.includes("muscle-up-support"));
  // A lone glitch to straight arms next to a bent-arm sample is not support.
  const glitch = h.feed([[-0.5, 120], [0.1, 70], [0.3, 80], [0.8, 170], [0.3, 85], [-0.2, 100], [-0.7, 150], HANG, HANG]);
  assert.equal(glitch.validRepCount, 0);
  assert.equal(glitch.partialRepCount, 3);
});

test("the far arm standing in during the turnover is a dropout; a lasting switch re-locks", () => {
  const h = harness();
  h.feed(arm);
  h.feed(up.slice(0, 5));
  // The locked arm is occluded over the bar for a frame and the other arm,
  // mid-turnover at a different angle, is reported instead.
  assert.equal(h.frame([-0.2, 150], { side: "right" }).phase, "transition");
  assert.equal(h.analyzer.selectedSide, "left");
  assert.equal(h.feed([...up.slice(5), ...down]).validRepCount, 1);
  h.feed(up.slice(0, 4));
  assert.equal(h.feed(Array(8).fill(HANG), { side: "right" }).phase, "unknown");
  assert.equal(h.analyzer.selectedSide, "right");
  assert.equal(h.feed([...arm, ...muscleUp], { side: "right" }).validRepCount, 2);
});

test("slow muscle-up with small alternating jitter counts once", () => {
  const h = harness();
  h.feed(arm);
  const path = interpolate([HANG, [-0.3, 90], [0.1, 55], [0.3, 70], [0.85, 170]], 12);
  const back = interpolate([[0.85, 170], [0.3, 100], [-0.3, 100], HANG], 12);
  const jitter = (samples) => samples.map(([ratio, elbow], index) =>
    [ratio + (index % 2 ? 0.02 : -0.02), elbow + (index % 2 ? 3 : -3)]);
  const snapshot = h.feed([...jitter(path), ...Array(12).fill([0.85, 170]), ...jitter(back), HANG, HANG]);
  assert.equal(snapshot.validRepCount, 1);
  assert.equal(snapshot.partialRepCount, 0);
});

test("one-frame dropouts or hand glitches mid-rep are skipped without a reset", () => {
  for (const at of [3, 6, 9, 11]) {
    for (const glitch of ["null", "wrist"]) {
      const h = harness();
      h.feed(arm);
      for (const [index, sample] of muscleUp.entries()) {
        if (index === at) {
          // A lost pose, or one frame with the wrist mislocated far off the bar.
          if (glitch === "null") h.frame(null);
          else h.frame([0.9, 170], { wristY: 0.9 });
        }
        h.frame(sample);
      }
      assert.equal(h.feed([HANG]).validRepCount, 1, `${glitch} at ${at}`);
    }
  }
});

test("a long tracking loss discards the unfinished rep, keeps the total, and needs a new hang", () => {
  const h = harness();
  h.feed([...arm, ...muscleUp, ...up.slice(0, 6)]);
  const lost = h.feed(Array(8).fill(null));
  assert.equal(lost.phase, "unknown");
  assert.equal(lost.validRepCount, 1);
  assert.equal(h.cue().id, "muscle-up-frame-body");
  // Tracking returning in support does not complete the discarded pull.
  assert.equal(h.feed(Array(6).fill([0.85, 170])).validRepCount, 1);
  assert.equal(h.feed([...arm, ...muscleUp]).validRepCount, 2);
  // Losing tracking after a counted lockout keeps that rep and never repeats it.
  h.feed(up);
  assert.equal(h.feed(Array(8).fill(null)).validRepCount, 3);
  assert.equal(h.feed([[0.85, 170], [0.85, 170], ...down, ...arm]).validRepCount, 3);
});

test("dropping off the bar and re-gripping cannot count, though standing looks like support", () => {
  const h = harness();
  h.feed([...arm, ...muscleUp]);
  // Standing with arms down: shoulder above wrist with straight elbows, but the
  // wrists are far below the bar height recorded in the hang.
  const standing = h.feed(Array(12).fill([0.9, 170]), { wristY: 0.85 });
  assert.equal(standing.phase, "unknown");
  assert.equal(standing.setupReady, false);
  const regrip = h.feed([[-0.5, 150], HANG, HANG, HANG]);
  assert.equal(regrip.validRepCount, 1);
  assert.equal(regrip.partialRepCount, 0);
  // Standing before ever hanging never arms the detector.
  const fresh = harness();
  assert.equal(fresh.feed(Array(12).fill([0.9, 170])).phase, "unknown");
  assert.equal(fresh.cue().id, "muscle-up-set-position");
});

test("arming requires a sustained straight-arm hang", () => {
  const h = harness();
  assert.equal(h.feed(Array(10).fill([-0.95, 120])).phase, "unknown");
  assert.equal(h.cue().id, "muscle-up-hold-start");
  assert.equal(h.feed(Array(4).fill(HANG)).phase, "unknown");
  assert.equal(h.feed([HANG, HANG]).phase, "bottom");
  // Starting in support cannot count.
  const top = harness();
  assert.equal(top.feed([...Array(10).fill([0.85, 170]), ...arm]).validRepCount, 0);
});

// Side-view landmarks for one arm: wrist fixed on the bar, shoulder placed at
// the requested height above the wrist, elbow at the requested angle.
function landmarks(shoulderAboveWrist, elbowAngleDeg, { aspectRatio = 1, leftVisibility = 0.99, rightVisibility = 0.8 } = {}) {
  const result = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 0.9, presence: 0.9 }));
  const segment = ARM_LENGTH / 2;
  const wrist = { x: 0.5, y: WRIST_Y };
  const span = ARM_LENGTH * Math.sin((elbowAngleDeg * Math.PI) / 360);
  const vertical = shoulderAboveWrist * ARM_LENGTH;
  const shoulder = { x: wrist.x + Math.sqrt(Math.max(0, span ** 2 - vertical ** 2)), y: wrist.y - vertical };
  const offset = segment * Math.cos((elbowAngleDeg * Math.PI) / 360);
  const elbow = {
    x: (shoulder.x + wrist.x) / 2 - offset * (shoulder.y - wrist.y) / span,
    y: (shoulder.y + wrist.y) / 2 + offset * (shoulder.x - wrist.x) / span,
  };
  for (const [indexes, visibility] of [[[11, 13, 15], leftVisibility], [[12, 14, 16], rightVisibility]]) {
    [shoulder, elbow, wrist].forEach((point, i) => {
      result[indexes[i]] = { x: point.x / aspectRatio, y: point.y, visibility, presence: visibility };
    });
  }
  return result;
}

test("measurement reads shoulder-above-wrist in arm lengths, corrects aspect ratio, and locks the stronger side", () => {
  for (const aspectRatio of [1, 16 / 9, 9 / 16]) {
    for (const [ratio, elbow] of [HANG, [0.3, 60], [0.85, 170]]) {
      const pose = measureMuscleUpPose(landmarks(ratio, elbow, { aspectRatio }), 0, aspectRatio);
      assert.equal(pose.side, "left");
      assert.ok(Math.abs(pose.shoulderAboveWrist - ratio) < 1e-6, `${ratio} @ ${aspectRatio}`);
      assert.ok(Math.abs(pose.elbowAngleDeg - elbow) < 1e-6);
      assert.ok(Math.abs(pose.armLength - ARM_LENGTH) < 1e-6);
    }
  }
  const changed = landmarks(0.3, 60, { leftVisibility: 0.7, rightVisibility: 0.99 });
  assert.equal(measureMuscleUpPose(changed, 0).side, "right");
  assert.equal(measureMuscleUpPose(changed, 0, 1, "left").side, "left");
  changed[13].visibility = 0.4;
  assert.equal(measureMuscleUpPose(changed, 0, 1, "left").side, "right");
  changed[14].presence = 0.4;
  assert.equal(measureMuscleUpPose(changed, 0), null);
  assert.equal(measureMuscleUpPose([], 0), null);
});

test("Pull-Up → Muscle-Up → Push-Up → Muscle-Up resets detector state; Pull-Up logic is unchanged", () => {
  const coach = new LiveCoachAnalyzer();
  const pull = new LiveVerticalPullAnalyzer();
  let time = 0;
  const step = (pose) => {
    const result = coach.update(pose, time);
    time += LIVE_STEP_MS;
    return result;
  };
  // Six hang samples: Pull-Up's 350 ms hang confirmation needs them at 83 ms.
  for (const angle of [150, 150, 150, 150, 150, 150, 130, 120, 45, 45, 45, 80, 100, 150, 150]) {
    const pose = pullUpLandmarkFixture({ elbowAngleDeg: angle, mouthY: angle <= 50 ? 0.12 : 0.3 });
    const expected = pull.update(measurePullUpPose(pose, time), time, true);
    assert.deepEqual(step(pose).snapshot, expected);
  }
  assert.equal(pull.getSnapshot().validRepCount, 1);

  const runMuscleUp = () => {
    let result;
    for (const [ratio, elbow] of [...arm, ...muscleUp]) result = step(landmarks(ratio, elbow));
    return result;
  };
  assert.equal(coach.selectMovement("muscle-up").validRepCount, 0);
  let result = runMuscleUp();
  assert.equal(result.snapshot.validRepCount, 1);
  assert.equal(result.cue.id, "muscle-up-rep-complete");
  // Stopping mid-turnover must not leak into the next movement.
  for (const [ratio, elbow] of up.slice(0, 5)) step(landmarks(ratio, elbow));

  assert.equal(coach.selectMovement("push-up").validRepCount, 0);
  result = step(landmarks(...HANG));
  assert.equal(result.snapshot.phase, "unknown");
  assert.equal(result.snapshot.validRepCount, 0);

  assert.equal(coach.selectMovement("muscle-up").validRepCount, 0);
  // The previous pull is gone: reaching support without a new hang cannot count.
  for (const [ratio, elbow] of up.slice(5)) result = step(landmarks(ratio, elbow));
  assert.equal(result.snapshot.phase, "unknown");
  assert.equal(result.snapshot.validRepCount, 0);
  assert.equal(result.snapshot.latestRep, null);
  assert.equal(runMuscleUp().snapshot.validRepCount, 1);
});

test("a failed muscle-up speaks Get over the bar through the voice coach", () => {
  assert.equal(correctionClip("get-over-bar"), "corrections/get-over-the-bar.mp3");
  assert.equal(cueClip("muscle-up-frame-body"), "setup/full-body-in-frame.mp3");
  assert.equal(cueClip("muscle-up-set-position"), "setup/hold-start-position.mp3");
  const played = [];
  const voice = new LiveCoachVoice({
    load() {}, close() {},
    play(path, onEnded) { played.push(path); onEnded(true); return { stop() {} }; },
  });
  const analyzer = new LiveMuscleUpAnalyzer();
  let time = 0;
  for (const [ratio, elbow] of [...arm, ...muscleUp, ...highPull]) {
    const snapshot = analyzer.update({ timestampMs: time, shoulderAboveWrist: ratio, elbowAngleDeg: elbow,
      wristY: WRIST_Y, armLength: ARM_LENGTH, minimumVisibility: 0.99, side: "left" }, time);
    voice.onFrame(snapshot, selectMuscleUpCue(snapshot, time), time);
    time += LIVE_STEP_MS;
  }
  // The valid rep is counted aloud; the failed attempt gets the correction once.
  assert.equal(played.filter((path) => path === "counts/01.mp3").length, 1);
  assert.equal(played.filter((path) => path === "corrections/get-over-the-bar.mp3").length, 1);
});
