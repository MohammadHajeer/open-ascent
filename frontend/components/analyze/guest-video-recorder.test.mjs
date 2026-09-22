import assert from "node:assert/strict";
import test from "node:test";

import {
  cameraErrorMessage,
  formatRecordingTime,
  guestCameraConstraints,
  recordingFileExtension,
  selectRecordingMimeType,
  startRecordingDeadline,
  stopMediaStream,
} from "./guest-video-recorder-support.ts";

test("recording MIME selection prefers compatible MP4 then VP8 WebM", () => {
  assert.equal(selectRecordingMimeType((type) => type === "video/mp4"), "video/mp4");
  assert.equal(selectRecordingMimeType((type) => type === "video/webm;codecs=vp8"), "video/webm;codecs=vp8");
  assert.equal(selectRecordingMimeType(() => false), null);
  assert.equal(recordingFileExtension("video/webm;codecs=vp8"), "webm");
});

test("camera constraints never request microphone and cap capture near 720p/30fps", () => {
  const constraints = guestCameraConstraints();
  assert.equal(constraints.audio, false);
  assert.deepEqual(constraints.video.width, { ideal: 1280, max: 1280 });
  assert.deepEqual(constraints.video.height, { ideal: 720, max: 720 });
  assert.deepEqual(constraints.video.frameRate, { ideal: 30, max: 30 });
});

test("recording timer reports elapsed time, stops at 20 seconds, and can be cleared manually", () => {
  let tick = null;
  let deadline = null;
  const cleared = [];
  let now = 0;
  let stopped = 0;
  const clear = startRecordingDeadline({
    maxDurationMs: 20_000,
    startedAt: 0,
    now: () => now,
    onTick: (elapsed) => { tick = elapsed; },
    onDeadline: () => { stopped += 1; },
    setIntervalFn: (callback) => { tick = callback; return 1; },
    clearIntervalFn: (id) => cleared.push(id),
    setTimeoutFn: (callback, delay) => { deadline = { callback, delay }; return 2; },
    clearTimeoutFn: (id) => cleared.push(id),
  });
  now = 8_400;
  const tickCallback = tick;
  tickCallback();
  assert.equal(tick, 8_400);
  assert.equal(formatRecordingTime(tick), "00:08");
  assert.equal(deadline.delay, 20_000);
  deadline.callback();
  assert.equal(stopped, 1);
  clear();
  assert.deepEqual(cleared, [1, 2]);
});

test("all active camera tracks are stopped during cleanup", () => {
  const stopped = [];
  stopMediaStream({ getTracks: () => [{ stop: () => stopped.push("video") }, { stop: () => stopped.push("extra") }] });
  assert.deepEqual(stopped, ["video", "extra"]);
});

test("permission denial has concise user-facing copy", () => {
  assert.match(cameraErrorMessage(new DOMException("denied", "NotAllowedError")), /denied/i);
});
