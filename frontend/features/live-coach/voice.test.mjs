import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { countClip, correctionClip, LiveCoachVoice } from "./voice.ts";

function harness({ failPath = "", rejectPath = "" } = {}) {
  const played = [];
  const paused = [];
  const clips = new Map();
  const voice = new LiveCoachVoice((path) => {
    if (path.includes(failPath) && failPath) throw new Error("missing clip");
    const clip = {
      preload: "none",
      currentTime: 0,
      onended: null,
      load() {},
      pause() { paused.push(path); },
      play() {
        played.push(path);
        return path.includes(rejectPath) && rejectPath
          ? Promise.reject(new Error("playback blocked"))
          : Promise.resolve();
      },
    };
    clips.set(path, clip);
    return clip;
  });
  return { voice, played, paused, clips };
}

function frame({ index = 0, outcome = "valid", count = 0 } = {}) {
  return {
    latestRep: index ? { index, outcome } : null,
    validRepCount: count,
  };
}

function cue(id) { return { id }; }

test("count and correction paths match the shipped MP3 pack", () => {
  assert.equal(countClip(1), "counts/01.mp3");
  assert.equal(countClip(50), "counts/50.mp3");
  assert.equal(countClip(51), null);
  assert.equal(correctionClip("finish-top"), "corrections/chin-over-bar.mp3");
  assert.equal(correctionClip("ready"), null);
  const voiceRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "public", "live-coach", "voice");
  for (let count = 1; count <= 50; count += 1) {
    assert.ok(existsSync(join(voiceRoot, countClip(count))));
  }
  assert.ok(existsSync(join(voiceRoot, correctionClip("finish-top"))));
});

test("only completed valid reps speak, and count interrupts lower-priority speech", () => {
  const h = harness();
  h.voice.preload();
  h.voice.start();
  h.voice.onFrame(frame(), cue("frame-body"), 0);
  h.voice.onFrame(frame({ index: 1, outcome: "partial" }), cue("finish-top"), 100);
  assert.ok(h.played.at(-1).endsWith("corrections/chin-over-bar.mp3"));
  h.voice.onFrame(frame({ index: 2, count: 1 }), cue("rep-complete"), 200);
  assert.ok(h.played.at(-1).endsWith("counts/01.mp3"));
  assert.ok(h.paused.some((path) => path.endsWith("corrections/chin-over-bar.mp3")));
  const playedCount = h.played.length;
  h.voice.onFrame(frame({ index: 2, count: 1 }), cue("finish-top"), 300);
  h.voice.onFrame(frame({ index: 2, count: 1 }), cue("finish-top"), 500);
  assert.equal(h.played.length, playedCount);
});

test("corrections are rate limited and failed or absent audio never throws", () => {
  const h = harness({ failPath: "counts/01.mp3" });
  h.voice.start();
  h.voice.onFrame(frame({ index: 1, count: 1 }), cue("rep-complete"), 100);
  h.voice.onFrame(frame({ index: 2, outcome: "partial", count: 1 }), cue("finish-top"), 200);
  h.voice.onFrame(frame({ index: 2, outcome: "partial", count: 1 }), cue("ready"), 300);
  h.voice.onFrame(frame({ index: 2, outcome: "partial", count: 1 }), cue("finish-top"), 400);
  assert.equal(h.played.filter((path) => path.endsWith("chin-over-bar.mp3")).length, 1);
  h.voice.stop();
});

test("muting voice does not affect analyzer events", () => {
  const h = harness();
  h.voice.setEnabled(false);
  h.voice.start();
  h.voice.onFrame(frame({ index: 1, count: 1 }), cue("rep-complete"), 100);
  assert.equal(h.played.length, 0);
});

test("rejected playback is contained and later counts still play", async () => {
  const h = harness({ rejectPath: "setup/get-ready.mp3" });
  h.voice.start();
  await Promise.resolve();
  h.voice.onFrame(frame({ index: 1, count: 1 }), cue("rep-complete"), 100);
  assert.ok(h.played.at(-1).endsWith("counts/01.mp3"));
});
