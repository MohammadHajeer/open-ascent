import assert from "node:assert/strict";
import test from "node:test";

import { selectDipCue } from "./cues.ts";
import { LiveDipAnalyzer, measureDipPose } from "./dip-analyzer.ts";
import { LiveCoachAnalyzer } from "./live-analyzer.ts";
import { correctionClip, cueClip, LiveCoachVoice } from "./voice.ts";

const STEP = 1000 / 12;
// The real rAF-gated loop lands 83 or 100 ms apart, occasionally a vsync later.
const CADENCE = [83.4, 100.1, 83.3, 83.4, 116.7];
const START = [170, 170, 170, 170, 170];
const DIP = [145, 125, 92, 90, 108, 140, 165, 170];

function harness(stepMs = STEP) {
  const analyzer = new LiveDipAnalyzer();
  let time = -stepMs;
  let snapshot;
  const frame = (angle, overrides = {}) => {
    time += stepMs;
    snapshot = analyzer.update(angle === null ? null : {
      timestampMs: time, angleDeg: angle, minimumVisibility: 0.99,
      side: "left", supportReady: true, wristX: 0, wristY: 0, armLength: 1, ...overrides,
    }, time);
    return snapshot;
  };
  const feed = (angles, overrides) => {
    for (const angle of angles) frame(angle, overrides);
    return snapshot;
  };
  return { analyzer, frame, feed, cue: () => selectDipCue(snapshot, time) };
}

// Side-view body in arm lengths (Drillis-Contini proportions): the wrists stay
// on the bars while the shoulder and hip travel, unlike a standing arm bend.
const ARM = 0.25;
const U = 0.56 * ARM, F = 0.44 * ARM, TORSO = 0.865 * ARM;
const rad = (degrees) => degrees * Math.PI / 180;

function dipPose(angle, { depression = 0 } = {}) {
  const flex = (180 - angle) / 90, tilt = rad(10 * flex), lean = rad(5 + 25 * flex);
  const elbow = [-F * Math.sin(tilt), F * Math.cos(tilt)];
  const [dx, dy] = [Math.sin(tilt), -Math.cos(tilt)];
  const a = rad(angle);
  const shoulder = [elbow[0] + U * (dx * Math.cos(a) - dy * Math.sin(a)), elbow[1] + U * (dx * Math.sin(a) + dy * Math.cos(a))];
  const hip = [shoulder[0] - (TORSO - depression) * Math.sin(lean), shoulder[1] - (TORSO - depression) * Math.cos(lean)];
  return [shoulder, elbow, [0, 0], hip];
}

// Standing on the floor beside the bars: the wrist hangs ~0.5 arm lengths
// below bar height, and bending the elbow moves the wrist, not the shoulder.
function standPose(angle) {
  const shoulder = [0, 0.51 * ARM];
  const elbow = [0, shoulder[1] - U];
  const wrist = [F * Math.sin(rad(180 - angle)), elbow[1] - F * Math.cos(rad(180 - angle))];
  return [shoulder, elbow, wrist, [0, shoulder[1] - TORSO]];
}

const mix = (from, to, p) => from.map((point, i) => point.map((value, axis) => value + (to[i][axis] - value) * p));

function place(pose, { yaw = 0, aspectRatio = 1, leftVisibility = 0.99, rightVisibility = 0.8 } = {}) {
  const result = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 0, presence: 0 }));
  for (const [indexes, visibility] of [[[11, 13, 15, 23], leftVisibility], [[12, 14, 16, 24], rightVisibility]]) {
    pose.forEach(([x, y], i) => {
      result[indexes[i]] = { x: 0.5 + x * Math.cos(rad(yaw)) / aspectRatio, y: 0.62 - y, visibility, presence: visibility };
    });
  }
  return result;
}

function coach(options = {}) {
  const analyzer = new LiveCoachAnalyzer();
  analyzer.selectMovement("dips");
  let time = 0, index = 0, result;
  const cues = [];
  const feed = (poses) => {
    for (const pose of poses) {
      result = analyzer.update(pose === null ? null : place(pose, options), time, options.aspectRatio ?? 1);
      cues.push(result.cue.id);
      time += CADENCE[index++ % CADENCE.length];
    }
    return result.snapshot;
  };
  return { feed, cues };
}

const dips = (angles, options) => angles.map((angle) => dipPose(angle, options));
const SUPPORT = dips(Array(6).fill(172));
const REAL_DIP = dips([155, 135, 112, 94, 87, 89, 104, 128, 152, 167, 172, 172]);

test("one dip follows support, lowering, bottom, pressing, support and counts once", () => {
  const h = harness();
  assert.equal(h.feed(START).phase, "top");
  const result = h.feed(DIP);
  assert.equal(result.validRepCount, 1);
  assert.deepEqual(result.latestRep.phases, ["top", "lowering", "bottom", "rising", "top"]);
  assert.equal(h.cue().id, "dip-rep-complete");
  assert.equal(h.feed(Array(20).fill(170)).validRepCount, 1);
});

test("multiple dips count once each; top support needs a new descent", () => {
  const h = harness();
  h.feed(START);
  assert.equal(h.feed(DIP).validRepCount, 1);
  assert.equal(h.feed(Array(12).fill(170)).validRepCount, 1);
  assert.equal(h.feed(DIP).validRepCount, 2);
  assert.equal(h.feed(DIP).validRepCount, 3);
});

test("shallow dip says Go lower only once it returns to support, with no count", () => {
  const h = harness();
  h.feed(START);
  h.feed([145, 125, 120, 120, 140, 145]);
  assert.equal(h.frame(155).formFault, null, "the turnaround alone is not a Go lower cue");
  const result = h.feed([170, 170]);
  assert.equal(result.validRepCount, 0);
  assert.equal(result.partialRepCount, 1);
  assert.equal(h.cue().title, "Go lower");
  assert.equal(h.feed(DIP).validRepCount, 1);
});

test("bottom without top extension, including a long hold, never counts", () => {
  const h = harness();
  h.feed(START);
  assert.equal(h.feed([145, 120, 90, 90, ...Array(24).fill(90)]).validRepCount, 0);
  assert.equal(h.feed([110, 130, ...Array(16).fill(140)]).validRepCount, 0);
  assert.equal(h.cue().title, "Extend your arms");
  assert.equal(h.feed([170, 170]).validRepCount, 1);
  assert.equal(h.feed(Array(15).fill(170)).validRepCount, 1);
});

test("holding top or starting at bottom cannot count", () => {
  const h = harness();
  assert.equal(h.feed(Array(30).fill(170)).validRepCount, 0);
  assert.equal(h.feed([145, ...Array(30).fill(90)]).validRepCount, 0);
  const unarmed = harness();
  assert.equal(unarmed.feed([...Array(12).fill(90), ...START]).validRepCount, 0);
});

test("threshold noise and single-frame reversals do not create a count", () => {
  const h = harness();
  h.feed(START);
  h.feed([151, 149, 152, 148, 170, 170, 149, 170, 170]);
  assert.equal(h.frame(170).phase, "top");
  assert.equal(h.feed([145, 120, 99, 97, 98, 96, 99, 120, 158, 162, 158, 162]).validRepCount, 0);
  assert.equal(h.feed([170, 170]).validRepCount, 0);
  assert.equal(h.feed(DIP).validRepCount, 1);
  assert.equal(h.feed([159, 161, 159, 162, 155, 162]).validRepCount, 1);
  // Jitter that does pass 95° next to a near-bottom sample is depth.
  const jitter = harness();
  jitter.feed(START);
  assert.equal(jitter.feed([145, 120, 98, 94, 98, 94, 98, 120, 158, 170, 170]).validRepCount, 1);
});

test("a single noisy sample past 95° on a shallow bottom is not depth", () => {
  const h = harness();
  h.feed(START);
  const result = h.feed([145, 125, 110, 94, 110, 112, 135, 160, 170, 170]);
  assert.equal(result.validRepCount, 0);
  assert.equal(result.partialRepCount, 1);
});

test("a fast dip that bounces through the bottom in one 12 fps sample counts", () => {
  for (const bounce of [[140, 105, 86, 99, 128, 160, 171], [140, 101, 86, 118, 150, 165, 172]]) {
    const h = harness();
    h.feed(START);
    const result = h.feed(bounce);
    assert.equal(result.validRepCount, 1, `bounce ${bounce}`);
    assert.equal(result.partialRepCount, 0);
  }
});

test("one-frame dropout survives; long tracking loss discards unfinished rep but preserves total", () => {
  const h = harness();
  h.feed(START);
  h.feed([145, 120, 90]);
  assert.equal(h.frame(null).phase, "lowering");
  h.feed([90, 110, 140, 170, 170]);
  assert.equal(h.frame(170).validRepCount, 1);
  h.feed([145, 120, 90, 90]);
  for (let i = 0; i < 8; i += 1) h.frame(null);
  assert.equal(h.frame(null).phase, "unknown");
  assert.equal(h.frame(null).validRepCount, 1);
  assert.equal(h.feed([170, 170, 170, 170, 170]).validRepCount, 1);
  assert.equal(h.feed(DIP).validRepCount, 2);
});

test("a short dropout at the bottom or at lockout keeps the rep", () => {
  const h = harness(100);
  h.feed(START);
  h.feed([145, 120, 90, 90]);
  for (let i = 0; i < 5; i += 1) h.frame(null);
  h.feed([100, 130, 160]);
  for (let i = 0; i < 4; i += 1) h.frame(null);
  assert.equal(h.feed([170, 170]).validRepCount, 1);
});

test("fast two-sample endpoints and slow small-step dips count at 12 fps", () => {
  const fast = harness();
  fast.feed(START);
  assert.equal(fast.feed([140, 110, 90, 90, 120, 145, 165, 170]).validRepCount, 1);
  const slow = harness();
  slow.feed(START);
  const descent = [149, 145, 140, 135, 130, 125, 120, 115, 110, 105, 100, 94, 90];
  const ascent = [92, 97, 102, 108, 114, 120, 126, 132, 138, 144, 150, 155, 161, 170];
  assert.equal(slow.feed([...descent, 90, ...ascent]).validRepCount, 1);
});

test("partial extension cannot count, even with another bottom", () => {
  const h = harness();
  h.feed(START);
  h.feed([145, 120, 90, 90, 110, 140, 150, 145, 90, 90, 115, 150]);
  assert.equal(h.frame(150).validRepCount, 0);
  assert.equal(h.feed([165, 170]).validRepCount, 1);
});

test("a return to extended arms without support cannot finish a dip", () => {
  const h = harness();
  h.feed(START);
  h.feed([145, 120, 90, 90, 115, 140]);
  assert.equal(h.feed([165, 170, 170], { supportReady: false }).validRepCount, 0);
  assert.equal(h.feed([170, 170], { supportReady: true }).validRepCount, 1);
  const unsupported = h.frame(170, { supportReady: false });
  assert.equal(unsupported.setupReady, false);
  assert.equal(h.cue().id, "dip-set-position");
});

test("hands leaving the bars pause the rep; staying off discards only the unfinished dip", () => {
  const h = harness();
  h.feed(START);
  h.feed([145, 120, 90, 90]);
  const off = h.frame(170, { wristY: 0.4 });
  assert.equal(off.phase, "bottom");
  assert.equal(off.setupReady, false);
  assert.equal(h.feed([110, 140, 170, 170]).validRepCount, 1);
  h.feed([145, 120, 90, 90]);
  assert.equal(h.feed(Array(8).fill(170), { wristY: 0.4 }).validRepCount, 1);
  assert.equal(h.frame(170, { wristY: 0.4 }).phase, "unknown");
});

test("the other arm standing in for one frame is a dropout; a lasting switch re-locks", () => {
  const h = harness();
  h.feed(START);
  h.feed(DIP);
  h.feed([145, 120, 90]);
  assert.equal(h.frame(92, { side: "right" }).phase, "lowering");
  assert.equal(h.analyzer.selectedSide, "left");
  assert.equal(h.feed([90, 120, 150, 170, 170]).validRepCount, 2);
  h.feed([145, 120, 90, 90]);
  assert.equal(h.feed(Array(8).fill(120), { side: "right" }).phase, "unknown");
  assert.equal(h.analyzer.selectedSide, "right");
  assert.equal(h.feed([...START, ...DIP], { side: "right" }).validRepCount, 3);
});

test("support geometry accepts real straight-arm support, rejects plank, locks the visible side", () => {
  // Active (depressed) shoulders lift the hip further above the wrists:
  // ~2 cm and ~4 cm on an adult arm.
  for (const depression of [0, 0.034 * ARM, 0.07 * ARM]) {
    const support = measureDipPose(place(dipPose(172, { depression }), { aspectRatio: 16 / 9 }), 0, 16 / 9);
    assert.ok(support.supportReady, `depression ${depression}`);
    assert.equal(Math.round(support.angleDeg), 172);
  }
  const plank = [[0, ARM], [0, F], [0, 0], [-0.9 * ARM, ARM - 0.01]];
  assert.equal(measureDipPose(place(plank), 0).supportReady, false);
  const clearerRight = place(dipPose(145), { leftVisibility: 0.7, rightVisibility: 0.99 });
  assert.equal(measureDipPose(clearerRight, 0).side, "right");
  assert.equal(measureDipPose(clearerRight, 0, 1, "left").side, "left");
  clearerRight[13].visibility = 0.3;
  assert.equal(measureDipPose(clearerRight, 0, 1, "left").side, "right");
  clearerRight[14].presence = 0.3;
  assert.equal(measureDipPose(clearerRight, 0), null);
});

test("a real dip counts through Live Coach at real cadence, side-on and slightly diagonal", () => {
  for (const options of [{}, { aspectRatio: 16 / 9 }, { yaw: 25 }]) {
    const c = coach(options);
    assert.equal(c.feed(SUPPORT).phase, "top");
    assert.equal(c.feed(REAL_DIP).validRepCount, 1, JSON.stringify(options));
    assert.equal(c.feed([...REAL_DIP, ...REAL_DIP]).validRepCount, 3);
    assert.ok(!c.cues.includes("dip-go-lower") && !c.cues.includes("dip-extend-arms"));
  }
  const active = coach();
  active.feed(dips(Array(6).fill(172), { depression: 0.07 * ARM }));
  assert.equal(active.feed(dips([155, 135, 112, 94, 87, 89, 104, 128, 152, 167, 172, 172], { depression: 0.07 * ARM })).validRepCount, 1);
});

test("standing arm bends and getting onto the bars never count", () => {
  // Standing arms-down is geometrically the same as top support, so it may
  // arm, but hands that leave that position cannot complete a dip.
  const standing = coach();
  const gesture = [150, 120, 90, 60, 60, 60, 90, 120, 150, 172, 172, 172].map(standPose);
  standing.feed([...Array(8).fill(standPose(172)), ...gesture, ...gesture, ...Array(10).fill(standPose(172))]);
  assert.equal(standing.feed(gesture).validRepCount, 0);
  assert.ok(!standing.cues.includes("dip-go-lower"));

  const mount = coach();
  mount.feed(Array(10).fill(standPose(172)));
  mount.feed([120, 90, 70, 60, 60, 60, 60, 60].map(standPose));
  const supported = mount.feed([mix(standPose(60), dipPose(172), 0.5), ...SUPPORT, ...SUPPORT]);
  assert.equal(supported.validRepCount, 0);
  assert.equal(supported.partialRepCount, 0);
  assert.equal(supported.phase, "top");
  assert.equal(mount.feed(REAL_DIP).validRepCount, 1);
});

test("stepping down after the set neither counts nor cues", () => {
  const failed = coach();
  failed.feed([...SUPPORT, ...REAL_DIP]);
  failed.feed(dips([150, 125, 100, 88, 86, 86, 86, 86]));
  const bottom = dipPose(86), stand = standPose(172);
  const afterFail = failed.feed([0.25, 0.5, 0.75, 1].map((p) => mix(bottom, stand, p)).concat(Array(30).fill(stand)));
  assert.equal(afterFail.validRepCount, 1);
  assert.equal(afterFail.partialRepCount, 0);

  const fromTop = coach();
  fromTop.feed([...SUPPORT, ...REAL_DIP]);
  // Feet reach the floor, legs push back up a little, then the hands let go.
  fromTop.feed(dips([152, 138, 125, 125, 134, 143]));
  const low = dipPose(143);
  const done = fromTop.feed([0.25, 0.5, 0.75, 1].map((p) => mix(low, stand, p)).concat(Array(30).fill(stand), Array(10).fill(null)));
  assert.equal(done.validRepCount, 1);
  assert.equal(done.partialRepCount, 0);
  assert.ok(!fromTop.cues.includes("dip-go-lower"));
  assert.ok(!fromTop.cues.includes("dip-extend-arms"));
});

test("Pull-Up → Push-Up → Muscle-Up → Dips → Pull-Up isolates phase, count, and cue", () => {
  const liveCoach = new LiveCoachAnalyzer();
  let time = 0;
  for (const movement of ["vertical-pull", "push-up", "muscle-up", "dips", "vertical-pull"]) {
    const reset = liveCoach.selectMovement(movement);
    assert.equal(reset.phase, "unknown");
    assert.equal(reset.validRepCount, 0);
    assert.equal(reset.latestRep, null);
    let result;
    const sequence = movement === "dips" ? [...SUPPORT, ...REAL_DIP] : [dipPose(172)];
    for (const pose of sequence) {
      result = liveCoach.update(place(pose), time);
      time += STEP;
    }
    if (movement === "dips") {
      assert.equal(result.snapshot.validRepCount, 1);
      assert.equal(result.cue.id, "dip-rep-complete");
    } else {
      assert.equal(result.snapshot.validRepCount, 0);
      assert.equal(result.snapshot.latestRep, null);
      assert.ok(!result.cue.id.startsWith("dip-"));
    }
  }
});

test("Dip correction and count use existing prerecorded voice clips", () => {
  assert.equal(correctionClip("dip-go-lower"), "corrections/control-the-descent.mp3");
  assert.equal(correctionClip("dip-extend-arms"), "corrections/full-extension.mp3");
  assert.equal(cueClip("dip-frame-body"), "setup/full-body-in-frame.mp3");
  const played = [];
  const voice = new LiveCoachVoice({
    load() {}, close() {},
    play(path, onEnded) { played.push(path); onEnded(true); return { stop() {} }; },
  });
  const h = harness();
  for (const angle of [...START, ...DIP, ...Array(15).fill(170)]) {
    const snapshot = h.frame(angle);
    voice.onFrame(snapshot, h.cue(), snapshot.observation.timestampMs);
  }
  assert.equal(played.filter((path) => path === "counts/01.mp3").length, 1);
});
