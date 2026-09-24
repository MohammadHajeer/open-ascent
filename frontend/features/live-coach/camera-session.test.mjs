import assert from "node:assert/strict";
import test from "node:test";

import {
  LiveCoachCameraSession,
  LiveCoachSessionError,
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
