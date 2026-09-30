import assert from "node:assert/strict";
import test from "node:test";

import { pullUpLandmarkFixture } from "./fixtures/pull-up-landmarks.ts";
import { LiveCoachAnalyzer } from "./live-analyzer.ts";
import { LiveVerticalPullAnalyzer } from "./vertical-pull-analyzer.ts";

// Camera/display invariance. Each movement is generated once as a physical
// pose, then photographed differently: landscape, portrait, or square frame;
// a horizontally mirrored frame (labels kept); and the athlete turned around
// (mirrored AND anatomical sides swapped, since the camera now sees the other
// side). The analyzer must respond to the body, not to the camera.

const rad = (degrees) => degrees * Math.PI / 180;
// The real rAF-gated loop lands 83 or 100 ms apart, occasionally a vsync later.
const CADENCE = [83.4, 100.1, 83.3, 83.4, 116.7];

const FRAMES = {
  landscape: [1280, 720],
  portrait: [720, 1280],
  square: [960, 960],
  // The camera's "basic" fallback mode.
  "4:3": [640, 480],
};

const LEFT = { shoulder: 11, elbow: 13, wrist: 15, hip: 23, knee: 25, ankle: 27, mouth: 9 };
const RIGHT = { shoulder: 12, elbow: 14, wrist: 16, hip: 24, knee: 26, ankle: 28, mouth: 10 };

/**
 * Photographs a physical pose (square units, x right, y down, body centred
 * near 0.5) into a W×H frame at a fixed pixel scale, as MediaPipe reports it:
 * x normalized by width and y by height.
 */
function photograph(points, [width, height], { mirror = false, swapSides = false, sideways = false } = {}) {
  const scale = 0.9 * Math.min(width, height);
  const result = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 0, presence: 0 }));
  points.forEach((point, index) => {
    if (!point) return;
    // A phone on its side with rotation locked: the scene turns 90°.
    const [px, py] = sideways ? [1 - point.y, point.x] : [point.x, point.y];
    let x = 0.5 + (px - 0.5) * scale / width;
    const y = 0.5 + (py - 0.5) * scale / height;
    if (mirror) x = 1 - x;
    result[index] = { ...point, x, y };
  });
  if (!swapSides) return result;
  const swapped = [...result];
  for (const key of Object.keys(LEFT)) {
    swapped[LEFT[key]] = result[RIGHT[key]];
    swapped[RIGHT[key]] = result[LEFT[key]];
  }
  return swapped;
}

// Side view with the athlete's left side nearest the camera (clearer landmarks).
function sidePose(joints) {
  const points = [];
  for (const [name, [x, y]] of Object.entries(joints)) {
    points[LEFT[name]] = { x, y, visibility: 0.98, presence: 0.98 };
    points[RIGHT[name]] = { x: x + 0.01, y: y + 0.005, visibility: 0.75, presence: 0.75 };
  }
  return points;
}

// Push-up plank, head to the left: the wrist stays on the floor, the elbow
// bends, and the shoulder and hip travel down together.
function pushUpPose(angle) {
  const upper = 0.14, fore = 0.13, wrist = [0.3, 0.72];
  const tilt = rad((180 - angle) / 2);
  const elbow = [wrist[0] + fore * Math.sin(tilt), wrist[1] - fore * Math.cos(tilt)];
  const shoulder = [elbow[0] - upper * Math.sin(tilt), elbow[1] - upper * Math.cos(tilt)];
  const drop = shoulder[1] - (wrist[1] - upper - fore);
  return sidePose({
    shoulder, elbow, wrist,
    hip: [shoulder[0] + 0.3, shoulder[1] + 0.02 + drop * 0.1],
    ankle: [shoulder[0] + 0.62, wrist[1] - 0.01],
  });
}

// Dip support (the dip-analyzer test's geometry, y up about the bar grip):
// the wrist stays on the bar while the shoulder and hip travel.
function dipPose(angle) {
  const upper = 0.14, fore = 0.11, torso = 0.216;
  const flex = (180 - angle) / 90, tilt = rad(10 * flex), lean = rad(5 + 25 * flex);
  const elbow = [-fore * Math.sin(tilt), fore * Math.cos(tilt)];
  const [dx, dy] = [Math.sin(tilt), -Math.cos(tilt)];
  const a = rad(angle);
  const shoulder = [elbow[0] + upper * (dx * Math.cos(a) - dy * Math.sin(a)), elbow[1] + upper * (dx * Math.sin(a) + dy * Math.cos(a))];
  const hip = [shoulder[0] - torso * Math.sin(lean), shoulder[1] - torso * Math.cos(lean)];
  const toFrame = ([x, y]) => [0.5 + x, 0.45 - y];
  return sidePose({ shoulder: toFrame(shoulder), elbow: toFrame(elbow), wrist: toFrame([0, 0]), hip: toFrame(hip) });
}

// Muscle-up about a fixed bar grip. progress 0 = straight-arm hang, 1 =
// straight-arm support; the forearm turns over the bar and the elbow bends
// most through the transition.
function muscleUpPose(progress) {
  const upper = 0.15, fore = 0.13, wrist = [0.5, 0.45];
  const forearm = rad(180 - 180 * progress);
  const elbowAngle = 172 - 100 * Math.sin(Math.PI * progress);
  const elbow = [wrist[0] + fore * Math.sin(forearm), wrist[1] - fore * Math.cos(forearm)];
  const upperDirection = forearm - rad(180 - elbowAngle);
  const shoulder = [elbow[0] + upper * Math.sin(upperDirection), elbow[1] - upper * Math.cos(upperDirection)];
  // The analyzer reads the arm only; the hanging torso lets the camera-level
  // check see which way is down.
  return sidePose({ shoulder, elbow, wrist, hip: [shoulder[0] + 0.03, shoulder[1] + 0.22] });
}

// Pull-up, front view: the shared fixture's square coordinates are physical.
function pullUpPose(angle) {
  const top = angle <= 50;
  // Mouth hidden, so the elbow angle alone must decide the top.
  return pullUpLandmarkFixture({ elbowAngleDeg: angle, mouthY: top ? 0.12 : 0.3 })
    .map((point, index) => index === 9 || index === 10 ? { ...point, visibility: 0.1, presence: 0.1 } : point);
}

const repeat = (sequence, times) => Array.from({ length: times }, () => sequence).flat();
const cosine = (from, to, steps) => Array.from({ length: steps }, (_, i) =>
  from + (to - from) * (0.5 - 0.5 * Math.cos(Math.PI * (i + 1) / steps)));

const MOVEMENTS = {
  "push-up": {
    poses: [...Array(6).fill(172), ...repeat([150, 125, 100, 88, 86, 95, 120, 145, 165, 172, 172], 3)].map(pushUpPose),
    reps: 3,
  },
  dips: {
    poses: [...Array(6).fill(172), ...repeat([155, 135, 112, 94, 87, 89, 104, 128, 152, 167, 172, 172], 3)].map(dipPose),
    reps: 3,
  },
  "muscle-up": {
    poses: [...Array(6).fill(0), ...repeat([...cosine(0, 1, 9), 1, 1, ...cosine(1, 0, 8), 0, 0], 3)].map(muscleUpPose),
    reps: 3,
  },
  "vertical-pull": {
    poses: [...Array(6).fill(172), ...repeat([150, 120, 90, 70, 45, 45, 70, 90, 120, 150, 172, 172, 172], 3)].map(pullUpPose),
    reps: 3,
  },
};

function run(movement, poses, frame, options = {}, cadence = CADENCE) {
  const analyzer = new LiveCoachAnalyzer();
  analyzer.selectMovement(movement);
  const [width, height] = frame;
  let time = 0, snapshot;
  const sides = new Set();
  const cues = new Set();
  poses.forEach((pose, index) => {
    const result = analyzer.update(pose && photograph(pose, frame, options), time, width / height);
    snapshot = result.snapshot;
    cues.add(result.cue.id);
    if (snapshot.observation?.side) sides.add(snapshot.observation.side);
    time += cadence[index % cadence.length];
  });
  return {
    valid: snapshot.validRepCount, partial: snapshot.partialRepCount, phases: snapshot.latestRep?.phases,
    sides: [...sides], cues: [...cues],
  };
}

const VIEWS = {
  plain: {},
  "mirrored frame": { mirror: true },
  "athlete turned around": { mirror: true, swapSides: true },
};

for (const [movement, { poses, reps }] of Object.entries(MOVEMENTS)) {
  test(`${movement}: mirrored frame and reversed facing give the same reps and phases`, () => {
    for (const frameName of Object.keys(FRAMES)) {
      const reference = run(movement, poses, FRAMES[frameName]);
      assert.equal(reference.valid, reps, `${frameName} reference`);
      assert.equal(reference.partial, 0, `${frameName} reference`);
      for (const [view, options] of Object.entries(VIEWS)) {
        const result = run(movement, poses, FRAMES[frameName], options);
        assert.deepEqual(
          { valid: result.valid, partial: result.partial, phases: result.phases },
          { valid: reference.valid, partial: reference.partial, phases: reference.phases },
          `${frameName} / ${view}`,
        );
      }
    }
  });
}

for (const movement of Object.keys(MOVEMENTS)) {
  test(`${movement}: portrait, landscape, square and 4:3 frames of one body give the same result`, () => {
    const { poses, reps } = MOVEMENTS[movement];
    const results = Object.entries(FRAMES).map(([name, frame]) => [name, run(movement, poses, frame)]);
    for (const [name, result] of results) {
      assert.equal(result.valid, reps, name);
      assert.equal(result.partial, 0, name);
      assert.deepEqual(result.phases, results[0][1].phases, name);
    }
  });
}

for (const movement of ["push-up", "dips", "muscle-up"]) {

  test(`${movement}: the analyzer follows the near side whichever way the athlete faces`, () => {
    const { poses } = MOVEMENTS[movement];
    // Left side nearest the camera, then the athlete turned around so the
    // right side is nearest.
    assert.deepEqual(run(movement, poses, FRAMES.landscape).sides, ["left"]);
    assert.deepEqual(run(movement, poses, FRAMES.landscape, { mirror: true, swapSides: true }).sides, ["right"]);
  });
}

// Pull-Up's thresholds are calibrated on 16:9 landscape; other frames are
// mapped into that reference frame, so a 16:9 frame must be read unchanged.
test("vertical-pull: a 16:9 landscape frame reads exactly as before the reference mapping", async () => {
  const { measurePullUpPose } = await import("./pull-up-semantics.ts");
  for (const pose of MOVEMENTS["vertical-pull"].poses.slice(0, 20)) {
    const landmarks = photograph(pose, FRAMES.landscape);
    assert.deepEqual(measurePullUpPose(landmarks, 0, 1280 / 720), measurePullUpPose(landmarks, 0));
  }
});

test("a sideways picture on an upright movement never counts and asks to turn the phone", () => {
  for (const movement of ["vertical-pull", "dips", "muscle-up"]) {
    const { poses } = MOVEMENTS[movement];
    for (const frame of [FRAMES.portrait, FRAMES.landscape]) {
      const result = run(movement, poses, frame, { sideways: true });
      assert.equal(result.valid, 0, movement);
      assert.ok(result.cues.includes("camera-rotated"), `${movement} cues ${result.cues}`);
    }
  }
});

test("an upright picture never asks to turn the phone, in any frame or facing", () => {
  for (const [movement, { poses }] of Object.entries(MOVEMENTS)) {
    for (const frame of Object.values(FRAMES)) {
      for (const options of Object.values(VIEWS)) {
        assert.ok(!run(movement, poses, frame, options).cues.includes("camera-rotated"), movement);
      }
    }
  }
});

test("Push-Up is never judged sideways: a plank on its side looks like standing", () => {
  const { poses } = MOVEMENTS["push-up"];
  assert.ok(!run("push-up", poses, FRAMES.portrait, { sideways: true }).cues.includes("camera-rotated"));
});

test("side-view analyzers count moderate reps identically at 12, 10 and 8 fps", () => {
  for (const movement of ["push-up", "dips", "muscle-up"]) {
    const { poses, reps } = MOVEMENTS[movement];
    for (const fps of [12, 10, 8]) {
      // Resample the 12 fps sequence at the slower rate: fewer poses, same motion.
      const stride = 12 / fps;
      const sampled = Array.from({ length: Math.floor(poses.length / stride) }, (_, i) => poses[Math.round(i * stride)]);
      const result = run(movement, sampled, FRAMES.landscape, {}, [1000 / fps]);
      assert.equal(result.valid, reps, `${movement} @ ${fps} fps`);
    }
  }
});

test("no analyzer counts more reps than performed at any frame rate", () => {
  for (const [movement, { poses, reps }] of Object.entries(MOVEMENTS)) {
    for (const fps of [12, 8, 6, 4, 2]) {
      const stride = 12 / fps;
      const sampled = Array.from({ length: Math.floor(poses.length / stride) }, (_, i) => poses[Math.round(i * stride)]);
      const result = run(movement, sampled, FRAMES.landscape, {}, [1000 / fps]);
      assert.ok(result.valid <= reps, `${movement} @ ${fps} fps counted ${result.valid}`);
    }
  }
});

test("a blind interval longer than 600 ms mid-rep never completes a rep, in any analyzer", () => {
  // Arm, go to the deepest point of the first rep, then no frames at all (a
  // hidden tab, a stalled inference) until the athlete is back at the start.
  const cases = {
    "push-up": [...Array(6).fill(172), 150, 120, 95, 88, 86].map(pushUpPose),
    dips: [...Array(6).fill(172), 155, 130, 100, 90, 87].map(dipPose),
    "muscle-up": [...Array(6).fill(0), ...cosine(0, 1, 9), 1, 1].map(muscleUpPose),
    "vertical-pull": [...Array(6).fill(172), 150, 120, 90, 45, 45].map(pullUpPose),
  };
  const end = { "push-up": pushUpPose(172), dips: dipPose(172), "muscle-up": muscleUpPose(0), "vertical-pull": pullUpPose(172) };
  for (const [movement, poses] of Object.entries(cases)) {
    const analyzer = new LiveCoachAnalyzer();
    analyzer.selectMovement(movement);
    let time = 0, snapshot;
    for (const pose of poses) {
      snapshot = analyzer.update(photograph(pose, FRAMES.landscape), time, 16 / 9).snapshot;
      time += 83;
    }
    const before = snapshot.validRepCount;
    time += 5000;
    for (let i = 0; i < 4; i += 1) {
      snapshot = analyzer.update(photograph(end[movement], FRAMES.landscape), time, 16 / 9).snapshot;
      time += 83;
    }
    // A muscle-up already counts at lockout, before the gap; nothing may be
    // added across it.
    assert.equal(snapshot.validRepCount, before, movement);
  }
});

test("vertical-pull: a top seen before a long frame gap cannot complete a rep after it", () => {
  const analyzer = new LiveVerticalPullAnalyzer();
  const observation = (timestampMs, angleDeg) => ({
    timestampMs, angleDeg,
    bodyRelativeY: angleDeg >= 145 ? 0.3 : angleDeg <= 50 ? 0.08 : 0.2,
    faceToWristY: angleDeg <= 50 ? -0.02 : 0.15,
    minimumVisibility: 0.99, handsAboveShoulders: true, bodyUnderHands: true,
  });
  let snapshot;
  for (const [t, angle] of [[0, 150], [100, 150], [200, 150], [300, 150], [400, 150], [500, 120], [600, 45]]) {
    snapshot = analyzer.update(observation(t, angle), t);
  }
  assert.equal(snapshot.phase, "top");
  snapshot = analyzer.update(observation(5600, 150), 5600);
  assert.equal(snapshot.validRepCount, 0);
  assert.equal(snapshot.phase, "unknown");
  // Tracking resumes normally: a fresh hang arms and the next rep counts.
  for (const [t, angle] of [[5700, 150], [5800, 150], [5900, 150], [6000, 150], [6100, 120], [6200, 45], [6300, 150]]) {
    snapshot = analyzer.update(observation(t, angle), t);
  }
  assert.equal(snapshot.validRepCount, 1);
});
