import assert from "node:assert/strict";
import test from "node:test";

import {
  LiveCoachCameraSession,
  LiveCoachSessionError,
  VIDEO_FRAME_WATCHDOG_MS,
} from "./camera-session.ts";

function harness({ mediaError, runtimeError, inferenceError } = {}) {
  let frameCallback = null;
  let cancelled = null;
  let stopped = 0;
  let closed = 0;
  let paused = 0;
  let now = 100;
  const track = {
    stop: () => stopped++,
    getSettings: () => ({ facingMode: "user", deviceId: "camera-1" }),
  };
  const stream = {
    getTracks: () => [track],
    getVideoTracks: () => [track],
  };
  const video = {
    srcObject: null,
    readyState: 3,
    play: async () => {},
    pause: () => paused++,
  };
  const runtime = {
    delegate: "CPU",
    detect: () => {
      if (inferenceError) throw inferenceError;
      return [];
    },
    close: () => closed++,
  };
  const session = new LiveCoachCameraSession({
    getUserMedia: async () => {
      if (mediaError) throw mediaError;
      return stream;
    },
    createPoseRuntime: async () => {
      if (runtimeError) throw runtimeError;
      return runtime;
    },
    requestFrame: (callback) => {
      frameCallback = callback;
      return 77;
    },
    cancelFrame: (handle) => {
      cancelled = handle;
    },
    now: () => now++,
  });

  return {
    session,
    video,
    invokeFrame: () => frameCallback?.(now),
    metrics: () => ({ stopped, closed, paused, cancelled }),
  };
}

test("camera lifecycle starts explicitly and stop releases every resource", async () => {
  const testHarness = harness();
  const result = await testHarness.session.start(testHarness.video, {
    onFrame: () => {},
  });

  assert.equal(result.delegate, "CPU");
  assert.ok(testHarness.video.srcObject);
  testHarness.session.stop();

  assert.deepEqual(testHarness.metrics(), {
    stopped: 1,
    closed: 1,
    paused: 1,
    cancelled: 77,
  });
  assert.equal(testHarness.video.srcObject, null);
});

test("permission denial is classified as a camera-stage failure", async () => {
  const denied = new DOMException("denied", "NotAllowedError");
  const testHarness = harness({ mediaError: denied });

  await assert.rejects(
    testHarness.session.start(testHarness.video, { onFrame: () => {} }),
    (error) =>
      error instanceof LiveCoachSessionError &&
      error.stage === "camera" &&
      error.cause === denied,
  );
  assert.equal(testHarness.video.srcObject, null);
  assert.equal(testHarness.metrics().paused, 1);
});

test("MediaPipe initialization failure releases the acquired camera", async () => {
  const testHarness = harness({ runtimeError: new Error("model failed") });

  await assert.rejects(
    testHarness.session.start(testHarness.video, { onFrame: () => {} }),
    (error) =>
      error instanceof LiveCoachSessionError && error.stage === "mediapipe",
  );
  assert.equal(testHarness.metrics().stopped, 1);
  assert.equal(testHarness.video.srcObject, null);
});

test("inference failure closes MediaPipe and stops the camera", async () => {
  const testHarness = harness({ inferenceError: new Error("inference failed") });
  let observedError = null;
  await testHarness.session.start(testHarness.video, {
    onFrame: () => {},
    onError: (error) => {
      observedError = error;
    },
  });
  testHarness.invokeFrame();

  assert.equal(observedError.stage, "inference");
  assert.equal(testHarness.metrics().closed, 1);
  assert.equal(testHarness.metrics().stopped, 1);
  assert.equal(testHarness.video.srcObject, null);
});

test("stopping while preview play is pending cannot initialize pose afterward", async () => {
  const testHarness = harness();
  let allowPlay;
  testHarness.video.play = () => new Promise((resolve) => { allowPlay = resolve; });
  const starting = testHarness.session.start(testHarness.video, {
    onFrame: () => assert.fail("a stopped session must not emit frames"),
  });
  await Promise.resolve();
  testHarness.session.stop();
  allowPlay();
  assert.equal(await starting, null);
  assert.equal(testHarness.metrics().stopped, 1);
  assert.equal(testHarness.metrics().closed, 0);
});

// ---- Frame timing ----------------------------------------------------------

/**
 * A session whose browser supports requestVideoFrameCallback (unless
 * `videoFrames` is false). The test drives both clocks by hand.
 */
function frameHarness({ videoFrames = true } = {}) {
  let animationCallback = null;
  let videoCallback = null;
  const cancelled = { animation: 0, video: 0 };
  let now = 0;
  const detected = [];
  const video = { srcObject: null, readyState: 3, play: async () => {}, pause: () => {} };
  const track = { stop() {}, getSettings: () => ({ facingMode: "user", deviceId: "camera-1" }) };
  const stream = { getTracks: () => [track], getVideoTracks: () => [track] };
  const session = new LiveCoachCameraSession({
    getUserMedia: async () => stream,
    createPoseRuntime: async () => ({
      delegate: "GPU",
      detect: (_video, timestampMs) => { detected.push(timestampMs); return []; },
      close() {},
    }),
    requestFrame: (callback) => { animationCallback = callback; return 1; },
    cancelFrame: () => { cancelled.animation += 1; },
    now: () => now,
    ...(videoFrames ? {
      requestVideoFrame: (_video, callback) => { videoCallback = callback; return 2; },
      cancelVideoFrame: () => { cancelled.video += 1; },
    } : {}),
  });
  const frames = [];
  return {
    session, video, detected, frames, cancelled,
    start: () => session.start(video, { onFrame: (frame) => frames.push(frame) }),
    setNow: (value) => { now = value; },
    animationFrame: (at) => {
      now = at;
      const callback = animationCallback;
      animationCallback = null;
      callback?.(at);
    },
    videoFrame: (at, info) => {
      now = at;
      const callback = videoCallback;
      videoCallback = null;
      callback?.(at, info);
    },
    pending: () => ({ animation: animationCallback !== null, video: videoCallback !== null }),
  };
}

test("each new camera frame is analyzed once, stamped with its capture time", async () => {
  const h = frameHarness();
  await h.start();
  h.videoFrame(1000, { presentedFrames: 1, captureTime: 960 });
  // The same presented frame again (or an older capture) is not re-analyzed.
  h.videoFrame(1005, { presentedFrames: 1, captureTime: 960 });
  h.videoFrame(1100, { presentedFrames: 2, captureTime: 950 });
  h.videoFrame(1200, { presentedFrames: 3, captureTime: 1150 });
  assert.deepEqual(h.detected, [960, 1150]);
  assert.deepEqual(h.frames.map((frame) => frame.timestampMs), [960, 1150]);
  // Without a capture time the callback's own time stamps the frame.
  h.videoFrame(1300, { presentedFrames: 4 });
  assert.deepEqual(h.detected, [960, 1150, 1300]);
});

test("a camera slower than the target rate is analyzed once per frame, never twice", async () => {
  const h = frameHarness();
  await h.start();
  // A dim phone camera at 10 fps; the display (and old loop) still runs at 60 Hz.
  for (let frame = 1; frame <= 20; frame += 1) {
    h.videoFrame(frame * 100, { presentedFrames: frame, captureTime: frame * 100 - 30 });
  }
  assert.equal(h.detected.length, 20);
  assert.equal(new Set(h.detected).size, 20);
  // Once video frame callbacks work, animation frames never analyze.
  h.animationFrame(2100);
  assert.equal(h.detected.length, 20);
  assert.equal(h.pending().animation, false);
});

test("a 30 fps camera is paced to about 12 analyses a second, without bursts", async () => {
  const h = frameHarness();
  await h.start();
  for (let frame = 1; frame <= 90; frame += 1) {
    h.videoFrame(frame * 1000 / 30, { presentedFrames: frame, captureTime: frame * 1000 / 30 });
  }
  const seconds = (h.detected.at(-1) - h.detected[0]) / 1000;
  const rate = (h.detected.length - 1) / seconds;
  assert.ok(rate > 11.5 && rate <= 12.5, `rate ${rate}`);
  const gaps = h.detected.slice(1).map((at, i) => at - h.detected[i]);
  assert.ok(Math.min(...gaps) > 60 && Math.max(...gaps) < 110, `gaps ${gaps}`);
  // After a stall the pacing restarts rather than catching up in a burst.
  h.videoFrame(10000, { presentedFrames: 200, captureTime: 10000 });
  h.videoFrame(10033, { presentedFrames: 201, captureTime: 10033 });
  h.videoFrame(10067, { presentedFrames: 202, captureTime: 10067 });
  assert.equal(h.detected.filter((at) => at >= 10000).length, 1);
});

test("without video frame callbacks, animation frames keep the 12 fps sampling", async () => {
  const h = frameHarness({ videoFrames: false });
  await h.start();
  for (let tick = 1; tick <= 120; tick += 1) h.animationFrame(tick * 1000 / 60);
  const gaps = h.detected.slice(1).map((at, i) => at - h.detected[i]);
  assert.ok(gaps.every((gap) => Math.abs(gap - 1000 / 12) < 0.5), `gaps ${gaps}`);
});

test("if video frame callbacks never arrive, animation frames take over", async () => {
  const h = frameHarness();
  await h.start();
  let t = 0;
  for (; t < VIDEO_FRAME_WATCHDOG_MS; t += 1000 / 60) h.animationFrame(t);
  assert.equal(h.detected.length, 0, "waits for video frames first");
  for (const end = t + 1000; t < end; t += 1000 / 60) h.animationFrame(t);
  assert.ok(h.detected.length >= 11, `analyzed ${h.detected.length}`);
  assert.equal(h.cancelled.video, 1, "the unused video frame request is cancelled");
  // A late video frame callback cannot double-drive analysis.
  const count = h.detected.length;
  h.videoFrame(t + 1, { presentedFrames: 1, captureTime: t + 1 });
  assert.equal(h.detected.length, count);
});

test("stop cancels both frame requests and ignores late callbacks", async () => {
  const h = frameHarness();
  await h.start();
  h.session.stop();
  assert.deepEqual(h.cancelled, { animation: 1, video: 1 });
  h.videoFrame(100, { presentedFrames: 1, captureTime: 100 });
  h.animationFrame(5000);
  assert.equal(h.detected.length, 0);
});
