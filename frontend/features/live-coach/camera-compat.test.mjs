import assert from "node:assert/strict";
import test from "node:test";

import {
  CAMERA_DISCONNECTED,
  LiveCoachCameraSession,
  LiveCoachSessionError,
} from "./camera-session.ts";
import { checkCameraSignal, frameStats, isBlankFrame } from "./camera-signal.ts";
import { cameraOptions } from "./session-state.ts";

function fill(pixels, rgb) {
  return Array.from({ length: pixels }, () => [...rgb, 255]).flat();
}

function scene(pixels) {
  return Array.from({ length: pixels }, (_, index) => [
    (index * 37) % 256, (index * 91) % 256, (index * 53) % 256, 255,
  ]).flat();
}

test("a solid green frame (zeroed YUV) is blank; a real scene is not", () => {
  assert.equal(isBlankFrame(frameStats(fill(1296, [0, 136, 0]))), true);
  assert.equal(isBlankFrame(frameStats(fill(1296, [0, 0, 0]))), true);
  assert.equal(isBlankFrame(frameStats(scene(1296))), false);
});

function probeFrom(frames, { hasFrame = true } = {}) {
  let index = 0;
  return {
    hasFrame: () => hasFrame,
    sample: () => frameStats(frames[Math.min(index++, frames.length - 1)]),
    wait: async () => {},
  };
}

test("signal check tolerates dark startup frames, then reports an image", async () => {
  const dark = fill(64, [2, 2, 2]);
  const result = await checkCameraSignal({}, probeFrom([dark, dark, scene(64)]));
  assert.equal(result.signal, "image");
});

test("signal check reports blank and no-frames distinctly", async () => {
  assert.equal((await checkCameraSignal({}, probeFrom([fill(64, [0, 136, 0])]))).signal, "blank");
  assert.equal((await checkCameraSignal({}, probeFrom([], { hasFrame: false }))).signal, "no-frames");
});

test("camera options drop pre-permission entries and disambiguate labels", () => {
  const options = cameraOptions([
    { kind: "videoinput", deviceId: "", label: "" },
    { kind: "audioinput", deviceId: "mic", label: "Mic" },
    { kind: "videoinput", deviceId: "a", label: "DroidCam Video" },
    { kind: "videoinput", deviceId: "b", label: "DroidCam Video" },
    { kind: "videoinput", deviceId: "c", label: "" },
  ]);
  assert.deepEqual(options.map((option) => option.label), ["DroidCam Video", "DroidCam Video (2)", "Camera 3"]);
});

function tieredHarness({ signals, failTier = null, deviceId = "phone-cam" }) {
  const requests = [];
  const streams = [];
  const video = { srcObject: null, readyState: 3, play: async () => {}, pause: () => {} };
  let check = 0;
  const session = new LiveCoachCameraSession({
    getUserMedia: async (constraints) => {
      requests.push(constraints.video);
      if (failTier !== null && requests.length - 1 === failTier) {
        throw new DOMException("mode unsupported", "OverconstrainedError");
      }
      const listeners = {};
      const track = {
        stopped: false,
        label: "Phone camera",
        stop() { this.stopped = true; },
        getSettings: () => ({ deviceId, width: 1280, height: 720, frameRate: 30 }),
        addEventListener: (type, listener) => { listeners[type] = listener; },
        end: () => listeners.ended?.(),
      };
      const stream = { track, getTracks: () => [track], getVideoTracks: () => [track] };
      streams.push(stream);
      return stream;
    },
    createPoseRuntime: async () => ({ delegate: "CPU", detect: () => [], close() {} }),
    requestFrame: () => 1,
    cancelFrame: () => {},
    now: () => 0,
    checkSignal: async () => ({ signal: signals[Math.min(check++, signals.length - 1)], stats: null }),
  });
  return { session, video, requests, streams };
}

test("a blank HD stream falls back on the same exact device and releases the old tracks", async () => {
  const { session, video, requests, streams } = tieredHarness({ signals: ["blank", "image"] });
  const result = await session.start(video, { onFrame: () => {} }, "phone-cam");

  assert.equal(result.signal, "image");
  assert.deepEqual(result.attempts.map((attempt) => attempt.tier), ["preferred", "native"]);
  assert.deepEqual(requests.map((request) => request.deviceId), [{ exact: "phone-cam" }, { exact: "phone-cam" }]);
  assert.deepEqual(requests[0].width, { ideal: 1280 });
  assert.equal(requests[1].width, undefined);
  assert.equal(streams[0].track.stopped, true);
  assert.equal(streams[1].track.stopped, false);
  assert.equal(video.srcObject, streams[1]);
  session.stop();
  assert.equal(streams[1].track.stopped, true);
});

test("without a chosen device, fallback tiers pin the camera the browser opened", async () => {
  const { session, video, requests } = tieredHarness({ signals: ["blank", "image"], deviceId: "laptop-cam" });
  await session.start(video, { onFrame: () => {} });
  assert.deepEqual(requests[0].facingMode, { ideal: "user" });
  assert.deepEqual(requests[1].deviceId, { exact: "laptop-cam" });
  assert.equal(requests[1].facingMode, undefined);
});

test("a camera blank in every mode settles back on HD, reports blank, and leaks no tracks", async () => {
  const { session, video, requests, streams } = tieredHarness({ signals: ["blank"] });
  let readySignal = null;
  const result = await session.start(video, { onFrame: () => {}, onCameraReady: (signal) => { readySignal = signal; } }, "phone-cam");

  assert.equal(result.signal, "blank");
  assert.equal(result.tier, "preferred");
  assert.equal(readySignal, "blank");
  assert.deepEqual(result.attempts.map((attempt) => attempt.tier), ["preferred", "native", "basic"]);
  assert.deepEqual(requests.at(-1), requests[0]);
  assert.deepEqual(streams.map((stream) => stream.track.stopped), [true, true, true, false]);
  assert.equal(video.srcObject, streams.at(-1));
});

test("a fallback mode the device rejects reopens the last mode that worked", async () => {
  const { session, video, requests, streams } = tieredHarness({ signals: ["blank"], failTier: 1 });
  const result = await session.start(video, { onFrame: () => {} }, "phone-cam");

  assert.equal(result.signal, "blank");
  assert.deepEqual(result.attempts.map((attempt) => attempt.signal), ["blank", "unavailable"]);
  assert.deepEqual(requests.at(-1), requests[0]);
  assert.equal(video.srcObject, streams.at(-1));
  assert.equal(streams.filter((stream) => !stream.track.stopped).length, 1);
});

test("a camera that disappears mid-session stops cleanly and reports the disconnect", async () => {
  const { session, video, streams } = tieredHarness({ signals: ["image"] });
  let reported = null;
  await session.start(video, { onFrame: () => {}, onError: (error) => { reported = error; } }, "phone-cam");
  streams[0].track.end();

  assert.ok(reported instanceof LiveCoachSessionError);
  assert.equal(reported.message, CAMERA_DISCONNECTED);
  assert.equal(streams[0].track.stopped, true);
  assert.equal(video.srcObject, null);
});

test("the Front/Rear choice sets facingMode; a specific camera still wins", async () => {
  const rear = tieredHarness({ signals: ["image"] });
  await rear.session.start(rear.video, { onFrame: () => {} }, undefined, "environment");
  assert.deepEqual(rear.requests[0].facingMode, { ideal: "environment" });
  assert.equal(rear.requests[0].deviceId, undefined);

  const front = tieredHarness({ signals: ["image"] });
  await front.session.start(front.video, { onFrame: () => {} });
  assert.deepEqual(front.requests[0].facingMode, { ideal: "user" });

  const chosen = tieredHarness({ signals: ["image"] });
  await chosen.session.start(chosen.video, { onFrame: () => {} }, "phone-cam", "environment");
  assert.deepEqual(chosen.requests[0].deviceId, { exact: "phone-cam" });
  assert.equal(chosen.requests[0].facingMode, undefined);
});
