import assert from "node:assert/strict";
import test from "node:test";

import { selectPushUpCue } from "./cues.ts";
import { LiveCoachAnalyzer } from "./live-analyzer.ts";
import { LivePushUpAnalyzer, measurePushUpPose } from "./push-up-analyzer.ts";
import { LiveVerticalPullAnalyzer } from "./vertical-pull-analyzer.ts";
import { measurePullUpPose } from "./pull-up-semantics.ts";
import { pullUpLandmarkFixture } from "./fixtures/pull-up-landmarks.ts";
import { correctionClip, LiveCoachVoice } from "./voice.ts";

function harness(stepMs = 100) {
  const analyzer = new LivePushUpAnalyzer();
  let time = -stepMs;
  let snapshot;
  const frame = (angle, overrides = {}) => {
    time += stepMs;
    snapshot = analyzer.update(angle === null ? null : {
      timestampMs: time, angleDeg: angle, bodyAngleDeg: 180,
      minimumVisibility: 0.99, side: "left", setupReady: true, ...overrides,
    }, time);
    return snapshot;
  };
  const feed = (angles, overrides) => {
    for (const angle of angles) frame(angle, overrides);
    return snapshot;
  };
  return { analyzer, frame, feed, cue: () => selectPushUpCue(snapshot, time) };
}

const start = [170, 170, 170, 170];
const cycle = [145, 120, 90, 90, 105, 140, 170, 170];

function landmarks(angle, { aspectRatio = 1, hipY = 0.4, leftVisibility = 0.99, rightVisibility = 0.8 } = {}) {
  const result = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 0, presence: 0 }));
  for (const [indexes, visibility] of [[[11, 13, 15, 23, 27], leftVisibility], [[12, 14, 16, 24, 28], rightVisibility]]) {
    const radians = angle * Math.PI / 180;
    const positions = [[0.2, 0.35], [0.2, 0.55], [0.2 + 0.2 * Math.sin(radians), 0.55 - 0.2 * Math.cos(radians)], [0.525, hipY], [0.85, 0.45]];
    indexes.forEach((index, i) => {
      result[index] = { x: positions[i][0] / aspectRatio, y: positions[i][1], visibility, presence: visibility };
    });
  }
  return result;
}

test("confirmed TOP → BOTTOM → TOP counts once with phases available to the UI", () => {
  const h = harness();
  h.feed(start);
  const snapshot = h.feed(cycle);
  assert.equal(snapshot.validRepCount, 1);
  assert.equal(snapshot.phase, "top");
  assert.deepEqual(snapshot.latestRep.phases, ["top", "lowering", "bottom", "rising", "top"]);
  assert.equal(h.cue().id, "push-rep-complete");
  assert.equal(h.feed(Array(20).fill(170)).validRepCount, 1);
  assert.equal(h.feed(cycle).validRepCount, 2);
  assert.equal(h.feed(cycle).validRepCount, 3);
});

test("partial descent gives Go lower and does not count", () => {
  const h = harness();
  h.feed(start);
  h.feed([145, 125, 140, 140]);
  assert.equal(h.cue().title, "Go lower");
  const snapshot = h.feed([170, 170]);
  assert.equal(snapshot.validRepCount, 0);
  assert.equal(snapshot.partialRepCount, 1);
  assert.equal(h.feed(cycle).validRepCount, 1);
});

test("full depth without extension never counts and stalled ascent cues Extend your arms", () => {
  const h = harness();
  h.feed(start);
  const snapshot = h.feed([145, 120, 90, 90, 105, 140, ...Array(15).fill(140)]);
  assert.equal(snapshot.validRepCount, 0);
  assert.equal(h.cue().title, "Extend your arms");
  assert.equal(h.feed([170, 170]).validRepCount, 1);
});

test("reversing downward before full extension cues extension without counting", () => {
  const h = harness();
  h.feed(start);
  h.feed([145, 90, 90, 120, 145, 130]);
  assert.equal(h.cue().id, "push-rising");
  h.frame(130);
  assert.equal(h.cue().id, "extend-arms");
  assert.equal(h.frame(90).validRepCount, 0);
});

test("remaining at top or bottom never repeats a count; starting at bottom cannot count", () => {
  const h = harness();
  assert.equal(h.feed(Array(25).fill(170)).validRepCount, 0);
  assert.equal(h.feed([145, ...Array(25).fill(90)]).validRepCount, 0);
  assert.equal(h.frame(90).phase, "bottom");
  const unarmed = harness();
  assert.equal(unarmed.feed([...Array(10).fill(90), ...start]).validRepCount, 0);
});

test("boundary jitter and isolated outliers cannot confirm endpoints or double count", () => {
  const h = harness();
  h.feed(start);
  // Jitter just shy of both thresholds never reaches bottom or lockout.
  h.feed([145, 120, 99, 97, 98, 96, 99, 120, 158, 159, 157, 159]);
  assert.equal(h.frame(158).validRepCount, 0);
  const shallow = h.feed([170, 170]);
  assert.equal(shallow.validRepCount, 0);
  assert.equal(shallow.partialRepCount, 1);
  assert.equal(h.feed(cycle).validRepCount, 1);
  assert.equal(h.feed([158, 162, 159, 163, 155, 160]).validRepCount, 1);
  // One-frame landmark jumps past a threshold are not depth or lockout, even
  // beside a sample that is near it.
  const outlier = harness();
  outlier.feed(start);
  const jump = outlier.feed([145, 120, 104, 78, 103, 120, 150, 170, 170]);
  assert.equal(jump.validRepCount, 0);
  assert.equal(jump.partialRepCount, 1);
  assert.equal(outlier.feed([145, 90, 90, 120, 152, 178, 150, 140]).validRepCount, 0);
  assert.equal(outlier.feed([170, 170]).validRepCount, 1);
  // Jitter that does pass 95° next to a near-bottom sample is depth.
  const jitter = harness();
  jitter.feed(start);
  assert.equal(jitter.feed([145, 120, 98, 94, 98, 94, 98, 120, 158, 170, 170]).validRepCount, 1);
  const spike = harness();
  spike.feed(start);
  for (const angle of [148, 170, 170, 90, 170, 170]) {
    assert.equal(spike.frame(angle).phase, "top");
    assert.equal(spike.cue().id, "push-ready");
  }
  assert.equal(spike.frame(170).partialRepCount, 0);
});

test("single-frame elbow spikes mid-descent or mid-ascent do not fire Go lower or Extend your arms", () => {
  const h = harness();
  h.feed(start);
  const cues = [];
  for (const angle of [145, 135, 125, 136, 120, 110, 100, 92, 90, 90, 105, 140, 150, 138, 165, 170, 170]) {
    h.frame(angle);
    cues.push(h.cue().id);
  }
  assert.ok(!cues.includes("go-lower") && !cues.includes("extend-arms"), cues.join(","));
  assert.equal(h.cue().id, "push-rep-complete");
  assert.equal(h.frame(170).validRepCount, 1);
});

test("at the real ~12 fps cadence, two samples at each endpoint count a brisk rep", () => {
  const h = harness(1000 / 12);
  h.feed([...start, 170]);
  const cues = [];
  for (const angle of [140, 110, 88, 86, 110, 140, 168, 170]) {
    h.frame(angle);
    cues.push(h.cue().id);
  }
  assert.ok(!cues.includes("go-lower") && !cues.includes("extend-arms"), cues.join(","));
  const snapshot = h.frame(150);
  assert.equal(snapshot.validRepCount, 1);
  assert.equal(snapshot.partialRepCount, 0);
});

test("a fast rep with one sample past the bottom and one past lockout counts, without cues", () => {
  for (const rep of [[135, 100, 86, 102, 140, 166, 151], [130, 94, 104, 145, 163, 152], [140, 104, 88, 110, 150, 168, 158]]) {
    const h = harness(1000 / 12);
    h.feed([...start, 170]);
    const cues = [];
    for (const angle of rep) {
      h.frame(angle);
      cues.push(h.cue().id);
    }
    assert.equal(h.frame(125).validRepCount, 1, `rep ${rep}`);
    assert.equal(h.analyzer.update(null, 0).partialRepCount, 0);
    assert.ok(!cues.includes("go-lower") && !cues.includes("extend-arms"), cues.join(","));
  }
});

// Back-to-back reps that never pause at either end, sampled at the live loop's
// real, uneven cadence (rAF-gated 12 fps lands 83 or 100 ms apart, sometimes 117).
const CADENCE = [83.4, 100.1, 83.3, 83.4, 116.7];
function continuousSet({ top, bottom, periodMs, reps, offsetMs = 0 }) {
  const analyzer = new LivePushUpAnalyzer();
  const cues = new Set();
  let time = 0, index = 0, snapshot;
  const frame = (angleDeg) => {
    snapshot = analyzer.update({ timestampMs: time, angleDeg, bodyAngleDeg: 176, minimumVisibility: 0.9, side: "left", setupReady: true }, time);
    cues.add(selectPushUpCue(snapshot, time).id);
    time += CADENCE[index++ % CADENCE.length];
  };
  while (time < 600) frame(170);
  const [mid, amplitude, begin] = [(top + bottom) / 2, (top - bottom) / 2, time - offsetMs];
  while (time < begin + reps * periodMs) frame(mid + amplitude * Math.cos(2 * Math.PI * (time - begin) / periodMs));
  const counted = { valid: snapshot.validRepCount, partial: snapshot.partialRepCount, cues };
  for (let i = 0; i < 6; i += 1) frame(170);
  return { ...counted, final: snapshot.validRepCount };
}

test("continuous fast push-ups with no pause at the top or bottom each count once", () => {
  for (const [periodMs, top, bottom] of [[1000, 163, 88], [800, 165, 88], [700, 168, 85]]) {
    for (let offsetMs = 0; offsetMs < 120; offsetMs += 17) {
      const set = continuousSet({ top, bottom, periodMs, reps: 8, offsetMs });
      const label = `${periodMs} ms, ${top}/${bottom}, offset ${offsetMs}`;
      // The rep in progress when sampling stops completes at the final lockout.
      assert.ok(set.valid >= 7, `${label}: ${set.valid}`);
      assert.equal(set.final, 8, label);
      assert.equal(set.partial, 0, label);
      assert.ok(!set.cues.has("go-lower") && !set.cues.has("extend-arms"), `${label}: ${[...set.cues]}`);
    }
  }
});

test("continuous fast reps that stop short of depth or lockout never count", () => {
  for (const periodMs of [1000, 800, 700]) {
    for (let offsetMs = 0; offsetMs < 120; offsetMs += 17) {
      const shallow = continuousSet({ top: 168, bottom: 108, periodMs, reps: 8, offsetMs });
      assert.equal(shallow.valid, 0, `shallow ${periodMs}/${offsetMs}`);
      assert.ok(shallow.partial >= 7);
      assert.ok(shallow.cues.has("go-lower"));
      // Without lockout the reps merge into one rising phase; only the final
      // full extension after the set completes a single rep.
      const unlocked = continuousSet({ top: 148, bottom: 85, periodMs, reps: 8, offsetMs });
      assert.equal(unlocked.valid, 0, `unlocked ${periodMs}/${offsetMs}`);
      assert.equal(unlocked.final, 1);
      assert.ok(unlocked.cues.has("extend-arms"));
    }
  }
});

test("exact thresholds require sustained samples, with ten degrees of top hysteresis", () => {
  const h = harness();
  assert.equal(h.feed([160, 160, 160, 160]).phase, "top");
  assert.equal(h.frame(151).phase, "top");
  assert.equal(h.frame(150).phase, "top");
  assert.equal(h.frame(150).phase, "lowering");
  assert.equal(h.frame(95).phase, "lowering");
  assert.equal(h.frame(95).phase, "bottom");
  assert.equal(h.feed([120, 159, 159]).validRepCount, 0);
  assert.equal(h.feed([160, 160]).validRepCount, 1);
});

test("sustained obvious sag/pike cues body line mid-rep, while natural deviations and brief noise do not", () => {
  for (const bodyAngleDeg of [110, 140]) {
    const h = harness();
    h.feed(Array(8).fill(170), { bodyAngleDeg });
    // Resting at the top (e.g. knees down after a set) is not mid-rep.
    assert.equal(h.cue().id, "push-ready");
    h.feed([145, 120, 90], { bodyAngleDeg });
    assert.equal(h.cue().title, "Keep your body straight");
    assert.equal(h.feed([90, 105, 140, 170, 170], { bodyAngleDeg }).validRepCount, 1);
  }
  // Getting into position with a bent body, before the arms lock out.
  const setup = harness();
  setup.feed(Array(10).fill(150), { bodyAngleDeg: 110 });
  assert.equal(setup.cue().id, "push-hold-start");
  setup.feed([...start, 145, 120], { bodyAngleDeg: 110 });
  assert.equal(setup.cue().id, "push-lowering");
  const tolerant = harness();
  tolerant.feed([...start, ...Array(10).fill(170)], { bodyAngleDeg: 155 });
  assert.equal(tolerant.cue().id, "push-ready");
  tolerant.feed([170, 170], { bodyAngleDeg: 120 });
  assert.equal(tolerant.cue().id, "push-ready");
});

test("brief dropouts or setup blips mid-rep are skipped instead of discarding the rep", () => {
  for (const at of [1, 3, 5, 6]) {
    for (const dropout of [[null], Array(5).fill(null)]) {
      const h = harness();
      h.feed(start);
      const angles = [...cycle.slice(0, at), ...dropout, ...cycle.slice(at)];
      assert.equal(h.feed(angles).validRepCount, 1, `dropout of ${dropout.length} at ${at}`);
    }
  }
  const blip = harness();
  blip.feed([...start, 145, 120, 90]);
  assert.equal(blip.frame(90, { setupReady: false }).setupReady, false);
  assert.equal(blip.feed([90, 105, 140, 170, 170]).validRepCount, 1);
});

test("loss longer than the frame-gap limit at any in-flight phase cannot complete a rep, preserves totals, and recovers at top", () => {
  for (const interrupted of [[145], [145, 90, 90], [145, 90, 90, 120], [145, 90, 90, 170]]) {
    const h = harness();
    h.feed([...start, ...cycle, ...interrupted]);
    const lost = h.feed(Array(7).fill(null));
    assert.equal(lost.validRepCount, 1);
    assert.equal(lost.phase, "unknown");
    assert.equal(lost.poseReady, false);
    assert.equal(h.cue().id, "push-frame-body");
    assert.equal(h.feed(start).validRepCount, 1);
    assert.equal(h.feed(cycle).validRepCount, 2);
  }
});

test("the far arm standing in for a frame is a dropout; a lasting switch re-locks without wiping totals", () => {
  const h = harness();
  h.feed([...start, ...cycle, 145, 90]);
  assert.equal(h.frame(60, { side: "right" }).phase, "lowering");
  assert.equal(h.analyzer.selectedSide, "left");
  assert.equal(h.feed([90, 105, 140, 170, 170]).validRepCount, 2);
  h.feed([145, 90, 90]);
  // The right arm stays the only usable one: the left candidate is discarded
  // after the frame-gap limit and counting re-arms on the right.
  assert.equal(h.feed(Array(7).fill(170), { side: "right" }).phase, "unknown");
  assert.equal(h.analyzer.selectedSide, "right");
  assert.equal(h.feed([...start, ...cycle], { side: "right" }).validRepCount, 3);
  const analyzer = new LivePushUpAnalyzer();
  let t = 0;
  for (const angleDeg of [...start, 145, 90, 90]) {
    analyzer.update({ timestampMs: t, angleDeg, bodyAngleDeg: 180, side: "left", setupReady: true }, t);
    t += 100;
  }
  t += 700;
  assert.equal(analyzer.update({ timestampMs: t, angleDeg: 170, bodyAngleDeg: 180, side: "left", setupReady: true }, t).validRepCount, 0);
});

test("measurement chooses the more visible complete side, locks it, and corrects video aspect ratio", () => {
  for (const aspectRatio of [1, 16 / 9, 9 / 16]) {
    const pose = measurePushUpPose(landmarks(90, { aspectRatio }), 0, aspectRatio);
    assert.equal(pose.side, "left");
    assert.ok(Math.abs(pose.angleDeg - 90) < 0.001);
    assert.ok(Math.abs(pose.bodyAngleDeg - 180) < 0.001);
    assert.equal(pose.setupReady, true);
  }
  const changed = landmarks(120, { leftVisibility: 0.7, rightVisibility: 0.99 });
  assert.equal(measurePushUpPose(changed, 0).side, "right");
  assert.equal(measurePushUpPose(changed, 0, 1, "left").side, "left");
  changed[13].visibility = 0.4;
  assert.equal(measurePushUpPose(changed, 0, 1, "left").side, "right");
});

test("occluded, nonfinite, degenerate, and standing poses cannot produce a valid setup", () => {
  const pose = landmarks(120);
  pose[13].presence = 0.4;
  pose[14].visibility = 0.4;
  assert.equal(measurePushUpPose(pose, 0), null);
  assert.equal(measurePushUpPose([], 0), null);
  const nonfinite = landmarks(120);
  nonfinite[11].x = NaN;
  nonfinite[12].x = Infinity;
  assert.equal(measurePushUpPose(nonfinite, 0), null);
  const degenerate = landmarks(120);
  degenerate[11] = { ...degenerate[13] };
  degenerate[12] = { ...degenerate[14] };
  assert.equal(measurePushUpPose(degenerate, 0), null);
  const standing = landmarks(170);
  standing[27] = { ...standing[27], x: 0.25, y: 0.95 };
  standing[28] = { ...standing[28], x: 0.25, y: 0.95 };
  assert.equal(measurePushUpPose(standing, 0).setupReady, false);
});

test("Pull-Up → Push-Up → Pull-Up resets detector state and matches unchanged pull-up logic", () => {
  const coach = new LiveCoachAnalyzer();
  const pull = new LiveVerticalPullAnalyzer();
  let time = 0;
  const pullAngles = [150, 150, 150, 150, 150, 130, 120, 45, 45, 45, 80, 100, 150, 150];
  for (const angle of pullAngles) {
    const pose = pullUpLandmarkFixture({ elbowAngleDeg: angle, mouthY: angle <= 50 ? 0.12 : 0.3 });
    const expected = pull.update(measurePullUpPose(pose, time), time, true);
    assert.deepEqual(coach.update(pose, time).snapshot, expected);
    time += 100;
  }
  assert.equal(pull.getSnapshot().validRepCount, 1);
  assert.equal(coach.selectMovement("push-up").validRepCount, 0);
  let result;
  for (const angle of [...start, ...cycle]) {
    result = coach.update(landmarks(angle), time);
    time += 100;
  }
  assert.equal(result.snapshot.validRepCount, 1);
  assert.equal(result.cue.id, "push-rep-complete");
  assert.equal(coach.selectMovement("vertical-pull").latestRep, null);
  assert.equal(coach.update(pullUpLandmarkFixture({ elbowAngleDeg: 45 }), time).snapshot.validRepCount, 0);
  assert.equal(coach.selectMovement("push-up").validRepCount, 0);
  assert.equal(coach.update(landmarks(90), time + 100).snapshot.phase, "unknown");
});

test("push-up corrections use prerecorded clips and rep counts retain voice priority/cooldowns", () => {
  assert.equal(correctionClip("go-lower"), "corrections/control-the-descent.mp3");
  assert.equal(correctionClip("extend-arms"), "corrections/full-extension.mp3");
  assert.equal(correctionClip("body-straight"), "corrections/brace-your-core.mp3");
  const played = [];
  const endings = [];
  const voice = new LiveCoachVoice({
    load() {}, close() {},
    play(path, end) { played.push(path); endings.push(end); return { stop() {} }; },
  });
  const snapshot = { phase: "top", validRepCount: 1, latestRep: { index: 1, outcome: "valid" } };
  voice.onFrame(snapshot, { id: "go-lower" }, 0);
  assert.equal(played.at(-1), "counts/01.mp3");
  endings[0](true);
  voice.onFrame(snapshot, { id: "go-lower" }, 100);
  assert.equal(played.at(-1), correctionClip("go-lower"));
  endings.at(-1)(true);
  voice.onFrame(snapshot, { id: "extend-arms" }, 200);
  assert.equal(played.length, 2);
  voice.onFrame(snapshot, { id: "extend-arms" }, 6200);
  assert.equal(played.at(-1), correctionClip("extend-arms"));
});
