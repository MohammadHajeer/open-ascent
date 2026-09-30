import assert from "node:assert/strict";
import test from "node:test";

import { CAMERA_LEVEL, CameraLevelMonitor, torsoTiltDeg } from "./camera-level.ts";
import { pullUpLandmarkFixture } from "./fixtures/pull-up-landmarks.ts";
import { aspectCorrected, PULL_UP_REFERENCE_ASPECT_RATIO, toPullUpReferenceFrame } from "./pose-geometry.ts";
import { measurePullUpPose } from "./pull-up-semantics.ts";
import { TRACKING_RATE, TrackingRateMonitor } from "./tracking-rate.ts";
import { LiveVerticalPullAnalyzer } from "./vertical-pull-analyzer.ts";

// ---- Shared geometry -------------------------------------------------------

test("side-view aspect correction puts x on the frame-height scale", () => {
  assert.deepEqual(aspectCorrected({ x: 0.5, y: 0.25, visibility: 0.9 }, 16 / 9), { x: 0.5 * 16 / 9, y: 0.25, visibility: 0.9 });
});

test("the Pull-Up reference frame leaves 16:9 landscape untouched and maps other frames", () => {
  const landmarks = pullUpLandmarkFixture({ elbowAngleDeg: 60 });
  for (const aspect of [PULL_UP_REFERENCE_ASPECT_RATIO, 1280 / 720, 1920 / 1080]) {
    assert.equal(toPullUpReferenceFrame(landmarks, aspect), landmarks);
  }
  const point = { x: 0.4, y: 0.6 };
  // 4:3 landscape: same short side, narrower width.
  assert.deepEqual(toPullUpReferenceFrame([point], 4 / 3)[0], { x: 0.4 * 0.75, y: 0.6 });
  // Portrait 9:16: width is the short side, the height is 16/9 short sides.
  const portrait = toPullUpReferenceFrame([point], 9 / 16)[0];
  assert.ok(Math.abs(portrait.x - 0.4 * 9 / 16) < 1e-12 && Math.abs(portrait.y - 0.6 * 16 / 9) < 1e-12);
  for (const invalid of [0, -1, NaN, Infinity]) assert.equal(toPullUpReferenceFrame(landmarks, invalid), landmarks);
});

test("one physical Pull-Up pose reads the same angle and heights in portrait and landscape", () => {
  // Fixture coordinates as physical units, photographed at one pixel scale.
  const shoot = (landmarks, width, height) => landmarks.map((point) => ({
    ...point,
    x: 0.5 + (point.x - 0.5) * 700 / width,
    y: 0.5 + (point.y - 0.5) * 700 / height,
  }));
  for (const angle of [172, 150, 90, 45]) {
    const pose = pullUpLandmarkFixture({ elbowAngleDeg: angle, mouthY: 0.12 });
    const landscape = measurePullUpPose(shoot(pose, 1280, 720), 0, 1280 / 720);
    const portrait = measurePullUpPose(shoot(pose, 720, 1280), 0, 720 / 1280);
    assert.ok(Math.abs(landscape.angleDeg - portrait.angleDeg) < 1e-9, `${angle}°`);
    assert.ok(Math.abs(landscape.bodyRelativeY - portrait.bodyRelativeY) < 1e-9);
    assert.ok(Math.abs(landscape.faceToWristY - portrait.faceToWristY) < 1e-9);
    assert.equal(landscape.bodyUnderHands, portrait.bodyUnderHands);
  }
});

// ---- Camera level (rotated phone) -------------------------------------------

function torso({ tiltDeg = 0, visibility = 0.9, length = 0.25, aspectRatio = 1 } = {}) {
  const landmarks = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 0.1 }));
  const radians = tiltDeg * Math.PI / 180;
  for (const [shoulder, hip, offset] of [[11, 23, -0.02], [12, 24, 0.02]]) {
    landmarks[shoulder] = { x: (0.5 + offset) / aspectRatio, y: 0.3, visibility };
    landmarks[hip] = { x: (0.5 + offset + length * Math.sin(radians)) / aspectRatio, y: 0.3 + length * Math.cos(radians), visibility };
  }
  return landmarks;
}

test("torso tilt is measured on the body, whatever the frame's aspect ratio", () => {
  for (const aspectRatio of [16 / 9, 9 / 16, 1]) {
    assert.ok(Math.abs(torsoTiltDeg(torso({ aspectRatio }), aspectRatio)) < 1e-9);
    assert.ok(Math.abs(torsoTiltDeg(torso({ tiltDeg: 30, aspectRatio }), aspectRatio) - 30) < 1e-9);
    assert.ok(Math.abs(torsoTiltDeg(torso({ tiltDeg: -90, aspectRatio }), aspectRatio) - 90) < 1e-9);
    assert.ok(Math.abs(torsoTiltDeg(torso({ tiltDeg: 180, aspectRatio }), aspectRatio) - 180) < 1e-9);
  }
  assert.equal(torsoTiltDeg(torso({ visibility: 0.3 }), 1), null, "hidden torso");
  assert.equal(torsoTiltDeg(torso({ length: 0.01 }), 1), null, "degenerate torso");
});

test("a sideways torso must persist before the phone is called rotated", () => {
  const monitor = new CameraLevelMonitor();
  let t = 0;
  const feed = (tiltDeg, frames) => {
    let rotated;
    for (let i = 0; i < frames; i += 1, t += 83) rotated = monitor.update(torso({ tiltDeg }), t, 1);
    return rotated;
  };
  assert.equal(feed(90, Math.floor(CAMERA_LEVEL.rotatedMinMs / 83)), false, "not yet sustained");
  assert.equal(feed(90, 2), true);
  // One upright sample is not enough to clear; two are.
  assert.equal(feed(0, 1), true);
  assert.equal(feed(0, 1), false);
});

test("leaning, kipping and brief sideways moments never read as a rotated phone", () => {
  const monitor = new CameraLevelMonitor();
  let t = 0;
  for (let rep = 0; rep < 10; rep += 1) {
    // A forward dip lean and a kip swing, with a one-second sideways moment.
    for (const tiltDeg of [0, 20, 35, 45, 30, 10, ...Array(11).fill(80), 0, 0]) {
      assert.equal(monitor.update(torso({ tiltDeg }), t, 1), false);
      t += 83;
    }
  }
});

test("a frame gap discards rotation evidence; missing torsos neither confirm nor clear", () => {
  const monitor = new CameraLevelMonitor();
  let t = 0;
  for (let i = 0; i < 10; i += 1, t += 83) monitor.update(torso({ tiltDeg: 90 }), t, 1);
  t += 2000;
  for (let i = 0; i < 10; i += 1, t += 83) assert.equal(monitor.update(torso({ tiltDeg: 90 }), t, 1), false);
  for (let i = 0; i < 10; i += 1, t += 83) monitor.update(torso({ tiltDeg: 90 }), t, 1);
  assert.equal(monitor.isRotated, true);
  assert.equal(monitor.update(null, t, 1), true);
  assert.equal(monitor.update(torso({ visibility: 0.2 }), t + 83, 1), true);
  monitor.reset();
  assert.equal(monitor.isRotated, false);
});

// ---- Tracking rate ------------------------------------------------------------

test("a sustained low tracking rate warns; warm-up, brief dips and no-rate frames do not", () => {
  const monitor = new TrackingRateMonitor();
  // Warm-up: slow first frames (model load, half-filled window) are ignored.
  for (let t = 0; t < TRACKING_RATE.warmupMs; t += 200) assert.equal(monitor.update(4, t), false);
  let t = TRACKING_RATE.warmupMs;
  // A two-second dip recovers before it counts.
  for (const end = t + 2000; t < end; t += 150) assert.equal(monitor.update(6, t), false);
  monitor.update(12, t);
  t += 83;
  assert.equal(monitor.update(0, t), false, "0 fps means no rate yet");
  for (const end = t + TRACKING_RATE.lowForMs; t < end; t += 150) monitor.update(6, t);
  assert.equal(monitor.update(6, t), true);
});

test("the low-rate warning clears only after the rate holds above the recovery line", () => {
  const monitor = new TrackingRateMonitor();
  let t = 0;
  for (; t < TRACKING_RATE.warmupMs + TRACKING_RATE.lowForMs + 200; t += 150) monitor.update(5, t);
  assert.equal(monitor.isLow, true);
  // Hovering between the lines neither clears nor re-arms the timer.
  for (const end = t + 5000; t < end; t += 110) assert.equal(monitor.update(8.5, t), true);
  for (const end = t + TRACKING_RATE.recoveredForMs - 100; t < end; t += 83) assert.equal(monitor.update(12, t), true);
  t += 200;
  assert.equal(monitor.update(12, t), false);
  monitor.reset();
  assert.equal(monitor.isLow, false);
});

// ---- Pull-Up invalid-frame tolerance -------------------------------------------

function pullObservation(timestampMs, angleDeg) {
  return {
    timestampMs, angleDeg,
    bodyRelativeY: angleDeg >= 145 ? 0.3 : angleDeg <= 50 ? 0.08 : 0.2,
    faceToWristY: angleDeg <= 50 ? -0.02 : 0.15,
    minimumVisibility: 0.99, handsAboveShoulders: true, bodyUnderHands: true,
  };
}

/** Hang, start the pull, then `invalid` null frames, then finish the rep. */
function pullWithDropout(stepMs, invalid) {
  const analyzer = new LiveVerticalPullAnalyzer();
  let t = 0, snapshot;
  const step = (angle) => {
    snapshot = analyzer.update(angle === null ? null : pullObservation(t, angle), t);
    t += stepMs;
  };
  for (let i = 0; t < 600; i += 1) step(150);
  step(120);
  for (let i = 0; i < invalid; i += 1) step(null);
  for (const angle of [45, 45, 150]) step(angle);
  return { snapshot, analyzer };
}

test("Pull-Up tolerates the same two invalid frames at 12 fps and at slower rates", () => {
  for (const stepMs of [83, 100, 125, 167, 250]) {
    assert.equal(pullWithDropout(stepMs, 2).snapshot.validRepCount, 1, `${stepMs} ms: two invalid frames`);
    assert.equal(pullWithDropout(stepMs, 3).snapshot.validRepCount, 0, `${stepMs} ms: three invalid frames`);
  }
});

test("Pull-Up's invalid tolerance keeps its 120 ms floor and stays under the blind-interval limit", () => {
  assert.equal(new LiveVerticalPullAnalyzer().invalidToleranceMs(), 120, "no rate yet");
  assert.equal(pullWithDropout(40, 0).analyzer.invalidToleranceMs(), 120, "fast frames");
  assert.ok(Math.abs(pullWithDropout(83, 0).analyzer.invalidToleranceMs() - 124.5) < 1e-9);
  assert.equal(pullWithDropout(500, 0).analyzer.invalidToleranceMs(), 600, "very slow frames");
});
