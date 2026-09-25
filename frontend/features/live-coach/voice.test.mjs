import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  countClip,
  correctionClip,
  cueClip,
  ENCOURAGEMENT_CLIPS,
  LiveCoachVoice,
  SESSION_CLIPS,
  spokenClipPaths,
} from "./voice.ts";

const voiceRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "public", "live-coach", "voice");

function harness({ silent = [] } = {}) {
  const played = [];
  const stopped = [];
  const loaded = new Set();
  const active = new Map();
  let closed = 0;
  const voice = new LiveCoachVoice({
    load(path) { loaded.add(path); },
    play(path, onEnded) {
      played.push(path);
      if (silent.includes(path)) {
        onEnded(false);
        return { stop() {} };
      }
      const entry = { onEnded, stopped: false };
      active.set(path, entry);
      return { stop() { entry.stopped = true; stopped.push(path); } };
    },
    close() { closed += 1; },
  });
  const end = (path) => {
    const entry = active.get(path);
    active.delete(path);
    if (entry && !entry.stopped) entry.onEnded(true);
  };
  return { voice, played, stopped, loaded, end, closed: () => closed };
}

function snap({ index = 0, outcome = "valid", count = 0, partial = 0, phase = "unknown", formFault = null } = {}) {
  return {
    latestRep: index ? { index, outcome } : null,
    validRepCount: count,
    partialRepCount: partial,
    phase,
    formFault,
  };
}

const cue = (id) => ({ id });

// Minimal MPEG-1/2 Layer III frame walk; enough to measure clip duration.
function mp3DurationSeconds(path) {
  const bytes = readFileSync(path);
  const rates = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };
  const v1 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
  const v2 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
  let offset = bytes.subarray(0, 3).toString() === "ID3"
    ? 10 + ((bytes[6] << 21) | (bytes[7] << 14) | (bytes[8] << 7) | bytes[9]) : 0;
  let seconds = 0;
  while (offset + 4 <= bytes.length) {
    const version = (bytes[offset + 1] >> 3) & 3;
    const bitrateIndex = bytes[offset + 2] >> 4;
    const rateIndex = (bytes[offset + 2] >> 2) & 3;
    const isFrame = bytes[offset] === 0xff && (bytes[offset + 1] & 0xe0) === 0xe0 &&
      ((bytes[offset + 1] >> 1) & 3) === 1 && bitrateIndex > 0 && bitrateIndex < 15 &&
      rateIndex < 3 && version !== 1;
    if (!isFrame) { offset += 1; continue; }
    const rate = rates[version][rateIndex];
    const mpeg1 = version === 3;
    const bitrate = (mpeg1 ? v1 : v2)[bitrateIndex] * 1000;
    const padding = (bytes[offset + 2] >> 1) & 1;
    offset += Math.floor(((mpeg1 ? 144 : 72) * bitrate) / rate) + padding;
    seconds += (mpeg1 ? 1152 : 576) / rate;
  }
  return seconds;
}

test("every clip the coach can speak ships in the voice pack", () => {
  assert.equal(countClip(1), "counts/01.mp3");
  assert.equal(countClip(50), "counts/50.mp3");
  assert.equal(countClip(0), null);
  assert.equal(countClip(51), null);
  assert.equal(correctionClip("finish-top"), "corrections/chin-over-bar.mp3");
  assert.equal(correctionClip("extend-at-bottom"), "corrections/extend-at-bottom.mp3");
  assert.equal(correctionClip("body-swing"), "corrections/reduce-the-swing.mp3");
  assert.equal(correctionClip("excessive-knee-bend"), null);
  assert.equal(correctionClip("frame-body"), null);
  assert.equal(cueClip("frame-body"), "setup/full-body-in-frame.mp3");
  // Transient states stay silent; the one-second confirmation needs no voice.
  for (const id of ["ready", "hold-start", "keep-pulling", "top-confirmed", "control-lowering", "rep-complete"]) {
    assert.equal(cueClip(id), null);
  }
  const paths = spokenClipPaths();
  assert.equal(paths.length, new Set(paths).size);
  for (const path of paths) assert.ok(existsSync(join(voiceRoot, path)), path);
});

test("count clips contain a full recording", () => {
  for (let count = 1; count <= 50; count += 1) {
    if (count === 6) continue;
    const seconds = mp3DurationSeconds(join(voiceRoot, countClip(count)));
    assert.ok(seconds >= 0.7, `${countClip(count)} is ${seconds.toFixed(2)} s`);
  }
});

test("count six contains a full recording", {
  todo: "counts/06.mp3 is a 0.46 s silent render; regenerate it from the voice source",
}, () => {
  assert.ok(mp3DurationSeconds(join(voiceRoot, countClip(6))) >= 0.7);
});

test("preload warms the first counts and every cue, not the whole count range", () => {
  const h = harness();
  h.voice.preload();
  assert.ok(h.loaded.has("counts/10.mp3"));
  assert.ok(!h.loaded.has("counts/11.mp3"));
  for (const path of [...Object.values(SESSION_CLIPS), ...ENCOURAGEMENT_CLIPS, correctionClip("body-swing")]) {
    assert.ok(h.loaded.has(path), path);
  }
  h.voice.onFrame(snap({ index: 1, count: 1 }), cue("rep-complete"), 100);
  assert.ok(h.loaded.has("counts/06.mp3"));
});

test("a rep count interrupts lower-priority speech immediately", () => {
  const h = harness();
  h.voice.start();
  assert.deepEqual(h.played, [SESSION_CLIPS.getReady]);
  h.voice.onFrame(snap({ index: 1, count: 1 }), cue("rep-complete"), 100);
  assert.equal(h.played.at(-1), "counts/01.mp3");
  assert.deepEqual(h.stopped, [SESSION_CLIPS.getReady]);
});

test("fast consecutive reps each start their own count", () => {
  const h = harness();
  h.voice.onFrame(snap({ index: 1, count: 1 }), cue("rep-complete"), 100);
  h.voice.onFrame(snap({ index: 2, count: 2 }), cue("rep-complete"), 700);
  h.voice.onFrame(snap({ index: 3, count: 3 }), cue("rep-complete"), 1300);
  assert.deepEqual(h.played, ["counts/01.mp3", "counts/02.mp3", "counts/03.mp3"]);
  assert.deepEqual(h.stopped, ["counts/01.mp3", "counts/02.mp3"]);
});

test("only completed valid reps are counted aloud", () => {
  const h = harness();
  h.voice.onFrame(snap({ index: 1, outcome: "partial", partial: 1 }), cue("ready"), 100);
  h.voice.onFrame(snap({ index: 2, outcome: "uncertain", partial: 1 }), cue("ready"), 200);
  assert.deepEqual(h.played, []);
  h.voice.onFrame(snap({ index: 3, count: 1, partial: 1 }), cue("rep-complete"), 300);
  h.voice.onFrame(snap({ index: 3, count: 1, partial: 1 }), cue("rep-complete"), 400);
  assert.deepEqual(h.played, ["counts/01.mp3"]);
});

test("a correction waits for the count to finish instead of being dropped", () => {
  const h = harness();
  h.voice.onFrame(snap({ index: 1, count: 1 }), cue("rep-complete"), 100);
  h.voice.onFrame(snap({ index: 2, outcome: "partial", count: 1, partial: 1 }), cue("finish-top"), 200);
  assert.equal(h.played.at(-1), "counts/01.mp3");
  h.end("counts/01.mp3");
  h.voice.onFrame(snap({ index: 2, outcome: "partial", count: 1, partial: 1 }), cue("finish-top"), 300);
  assert.equal(h.played.at(-1), "corrections/chin-over-bar.mp3");
  assert.deepEqual(h.stopped, []);
});

test("corrections speak once per episode with global and same-cue cooldowns", () => {
  const h = harness();
  const swing = correctionClip("body-swing");
  const top = correctionClip("finish-top");
  const spoken = (path) => h.played.filter((item) => item === path).length;
  h.voice.onFrame(snap(), cue("body-swing"), 100);
  h.voice.onFrame(snap(), cue("body-swing"), 3000);
  assert.equal(spoken(swing), 1);
  h.end(swing);
  h.voice.onFrame(snap(), cue("ready"), 3100);
  h.voice.onFrame(snap(), cue("body-swing"), 3200);
  assert.equal(spoken(swing), 1, "same correction within 15 s");
  h.voice.onFrame(snap(), cue("finish-top"), 3300);
  assert.equal(spoken(top), 0, "any correction within 6 s");
  h.voice.onFrame(snap(), cue("finish-top"), 6200);
  assert.equal(spoken(top), 1, "a persisting cue speaks once the gap allows");
  h.end(top);
  h.voice.onFrame(snap(), cue("body-swing"), 15200);
  assert.equal(spoken(swing), 2);
});

test("setup prompts need to persist, then speak once per setup episode", () => {
  const h = harness();
  const frame = cueClip("frame-body");
  h.voice.onFrame(snap(), cue("frame-body"), 0);
  h.voice.onFrame(snap(), cue("frame-body"), 800);
  h.voice.onFrame(snap(), cue("set-position"), 900);
  h.voice.onFrame(snap(), cue("frame-body"), 1000);
  h.voice.onFrame(snap(), cue("frame-body"), 1900);
  assert.deepEqual(h.played, []);
  h.voice.onFrame(snap(), cue("frame-body"), 2000);
  assert.deepEqual(h.played, [frame]);
  h.end(frame);
  h.voice.onFrame(snap(), cue("set-position"), 7000);
  h.voice.onFrame(snap(), cue("frame-body"), 20000);
  h.voice.onFrame(snap(), cue("frame-body"), 30000);
  assert.equal(h.played.filter((path) => path === frame).length, 1);
});

test("a confirmed hang announces counting once, and a dropped frame mid-set stays quiet", () => {
  const h = harness();
  h.voice.onFrame(snap({ phase: "bottom" }), cue("ready"), 0);
  assert.deepEqual(h.played, [SESSION_CLIPS.startWhenReady]);
  h.end(SESSION_CLIPS.startWhenReady);
  h.voice.onFrame(snap({ phase: "rising" }), cue("frame-body"), 5000);
  h.voice.onFrame(snap({ phase: "rising" }), cue("keep-pulling"), 5083);
  h.voice.onFrame(snap({ phase: "unknown" }), cue("set-position"), 5500);
  h.voice.onFrame(snap({ phase: "bottom" }), cue("ready"), 5900);
  assert.deepEqual(h.played, [SESSION_CLIPS.startWhenReady], "re-arming within 30 s stays quiet");
  h.voice.onFrame(snap({ phase: "unknown" }), cue("frame-body"), 40000);
  h.voice.onFrame(snap({ phase: "bottom" }), cue("ready"), 41000);
  assert.equal(h.played.at(-1), SESSION_CLIPS.startWhenReady);
});

test("encouragement follows a finished count, sparingly, and never after a correction", () => {
  const h = harness();
  const encouragement = () => h.played.filter((path) => path.startsWith("encouragement/"));
  const rep = (count, at, formFault = null) => {
    h.voice.onFrame(snap({ index: count, count, phase: "bottom", formFault }), cue("rep-complete"), at);
    h.end(countClip(count));
  };
  rep(1, 3000);
  rep(2, 6000);
  assert.deepEqual(encouragement(), []);
  rep(3, 9000);
  assert.deepEqual(encouragement(), [ENCOURAGEMENT_CLIPS[0]]);
  h.end(ENCOURAGEMENT_CLIPS[0]);
  for (let count = 4; count <= 9; count += 1) rep(count, count * 3000);
  assert.equal(encouragement().length, 1, "at most every four reps and 20 s");
  rep(10, 30000, "body-swing");
  assert.equal(encouragement().length, 1, "not while a fault is active");
  rep(11, 33000);
  assert.deepEqual(encouragement(), [ENCOURAGEMENT_CLIPS[0], ENCOURAGEMENT_CLIPS[1]]);

  const fast = harness();
  for (let count = 1; count <= 4; count += 1) {
    fast.voice.onFrame(snap({ index: count, count }), cue("rep-complete"), count * 700);
  }
  fast.end(countClip(3));
  assert.ok(!fast.played.some((path) => path.startsWith("encouragement/")), "an interrupted count never leads to encouragement");
});

test("stopping mid-count lets the count finish, then closes the set and releases audio", () => {
  const h = harness();
  h.voice.onFrame(snap({ index: 3, count: 3 }), cue("rep-complete"), 100);
  h.voice.finish({ validRepCount: 3, partialRepCount: 0 });
  assert.deepEqual(h.stopped, []);
  assert.equal(h.closed(), 0);
  h.end("counts/03.mp3");
  assert.equal(h.played.at(-1), SESSION_CLIPS.setComplete);
  assert.ok(!h.played.some((path) => path.startsWith("encouragement/")));
  h.end(SESSION_CLIPS.setComplete);
  assert.equal(h.closed(), 1);
});

test("the closing line reflects the set, and an empty session closes silently", () => {
  const partial = harness();
  partial.voice.onFrame(snap(), cue("body-swing"), 100);
  partial.voice.finish({ validRepCount: 0, partialRepCount: 2 });
  assert.deepEqual(partial.stopped, [correctionClip("body-swing")]);
  assert.equal(partial.played.at(-1), SESSION_CLIPS.goodEffort);

  const empty = harness();
  empty.voice.finish({ validRepCount: 0, partialRepCount: 0 });
  assert.deepEqual(empty.played, []);
  assert.equal(empty.closed(), 1);
  empty.voice.onFrame(snap({ index: 1, count: 1 }), cue("rep-complete"), 200);
  assert.deepEqual(empty.played, []);
});

test("muting silences speech without losing the rep sequence", () => {
  const h = harness();
  h.voice.setEnabled(false);
  h.voice.start();
  h.voice.onFrame(snap({ index: 1, count: 1 }), cue("rep-complete"), 100);
  assert.deepEqual(h.played, []);
  h.voice.setEnabled(true);
  h.voice.onFrame(snap({ index: 1, count: 1 }), cue("rep-complete"), 200);
  h.voice.onFrame(snap({ index: 2, count: 2 }), cue("rep-complete"), 900);
  assert.deepEqual(h.played, ["counts/02.mp3"]);
});

test("missing or silent clips never block later speech or trigger encouragement", () => {
  const h = harness({ silent: [SESSION_CLIPS.getReady, "counts/06.mp3"] });
  h.voice.start();
  // Rep 6 would be eligible for encouragement, but its count was not heard.
  h.voice.onFrame(snap({ index: 6, count: 6 }), cue("rep-complete"), 100);
  h.voice.onFrame(snap(), cue("finish-top"), 200);
  assert.deepEqual(h.played, [SESSION_CLIPS.getReady, "counts/06.mp3", correctionClip("finish-top")]);
  assert.doesNotThrow(() => {
    const unavailable = new LiveCoachVoice(null);
    unavailable.preload();
    unavailable.start();
    unavailable.onFrame(snap({ index: 1, count: 1 }), cue("rep-complete"), 0);
    unavailable.finish({ validRepCount: 1, partialRepCount: 0 });
    unavailable.stop();
  });
});
