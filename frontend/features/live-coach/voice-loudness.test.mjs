import assert from "node:assert/strict";
import test from "node:test";

import {
  integratedLoudness,
  kWeightingFilters,
  normalizationGain,
  prepareVoiceSamples,
  samplePeak,
  speechBounds,
  VOICE_MASTERING,
} from "./voice-loudness.ts";

const RATE = 48000;

function tone({ seconds, peakDb, frequency = 997, leadSeconds = 0, tailSeconds = 0 }) {
  const lead = Math.round(leadSeconds * RATE);
  const body = Math.round(seconds * RATE);
  const samples = new Float32Array(lead + body + Math.round(tailSeconds * RATE));
  const amplitude = 10 ** (peakDb / 20);
  for (let index = 0; index < body; index += 1) {
    samples[lead + index] = amplitude * Math.sin((2 * Math.PI * frequency * index) / RATE);
  }
  return samples;
}

const db = (linear) => 20 * Math.log10(linear);

test("K-weighting reproduces the published BS.1770 48 kHz coefficients", () => {
  const [shelf, highPass] = kWeightingFilters(RATE);
  const expected = [
    [shelf.b, [1.53512485958697, -2.69169618940638, 1.19839281085285]],
    [shelf.a, [1, -1.69065929318241, 0.73248077421585]],
    [highPass.b, [1, -2, 1]],
    [highPass.a, [1, -1.99004745483398, 0.99007225036621]],
  ];
  for (const [actual, reference] of expected) {
    actual.forEach((value, index) => assert.ok(Math.abs(value - reference[index]) < 1e-8));
  }
});

test("integrated loudness matches the BS.1770 sine reference and ignores silence", () => {
  // A full-scale 997 Hz sine in one channel measures -3.01 LUFS.
  assert.ok(Math.abs(integratedLoudness(tone({ seconds: 2, peakDb: 0 }), RATE) + 3.01) < 0.05);
  const quiet = integratedLoudness(tone({ seconds: 2, peakDb: -20 }), RATE);
  assert.ok(Math.abs(quiet + 23.01) < 0.05);
  // Doubling the length with silence would read 3 dB low ungated; the gates
  // leave only the blocks that straddle the silence edges.
  const padded = integratedLoudness(tone({ seconds: 2, peakDb: -20, leadSeconds: 1, tailSeconds: 1 }), RATE);
  assert.ok(Math.abs(padded - quiet) < 1, "gating excludes padding silence");
  assert.equal(integratedLoudness(new Float32Array(RATE), RATE), -Infinity);
  assert.ok(Number.isFinite(integratedLoudness(tone({ seconds: 0.2, peakDb: -20 }), RATE)));
});

test("normalization lifts quiet speech to the target without passing the peak ceiling", () => {
  const quiet = normalizationGain(-24, 10 ** (-12 / 20));
  assert.ok(Math.abs(db(quiet) - 8) < 1e-9);
  const peaky = normalizationGain(-22, 10 ** (-3 / 20));
  assert.ok(Math.abs(db(peaky) - 2) < 1e-9, "stops at -1 dBFS rather than limiting");
  assert.ok(Math.abs(db(normalizationGain(-40, 0.001)) - VOICE_MASTERING.maxBoostDb) < 1e-9);
  assert.ok(db(normalizationGain(-6, 0.9)) < 0, "loud clips are turned down");
  assert.equal(normalizationGain(-Infinity, 0), 1);
});

test("prepared clips start near the first sound, keep soft onsets, and never clip", () => {
  const samples = tone({ seconds: 0.8, peakDb: -9, leadSeconds: 0.9, tailSeconds: 0.6 });
  // A fricative-like onset at -45 dBFS just before the vowel must survive trimming.
  const onset = Math.round(0.85 * RATE);
  for (let index = onset; index < Math.round(0.9 * RATE); index += 1) samples[index] = (index % 2 ? 1 : -1) * 10 ** (-45 / 20);
  const prepared = prepareVoiceSamples(samples, RATE);
  assert.ok(prepared);
  assert.ok(Math.abs(prepared.trimmedLeadMs - (850 - VOICE_MASTERING.leadPadMs)) < 1);
  const bounds = speechBounds(samples, RATE);
  assert.ok(bounds.start <= onset && bounds.end >= Math.round(1.7 * RATE));
  assert.ok(prepared.samples.length < samples.length - 0.8 * RATE);
  assert.ok(db(samplePeak(prepared.samples) * prepared.gain) <= VOICE_MASTERING.peakCeilingDb + 1e-9);
});

test("a silent clip is reported as unplayable", () => {
  const nearSilent = tone({ seconds: 0.4, peakDb: -54 });
  assert.equal(prepareVoiceSamples(nearSilent, RATE), null);
});
