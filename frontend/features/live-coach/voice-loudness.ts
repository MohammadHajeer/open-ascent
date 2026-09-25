// Pure, deterministic voice-clip mastering applied once when a clip is
// decoded. Loudness follows ITU-R BS.1770 (K-weighted, gated, mono) so every
// clip plays at a consistent level; a fixed per-clip gain with a sample-peak
// ceiling cannot clip or distort.

export const VOICE_MASTERING = {
  targetLufs: -16,
  peakCeilingDb: -1,
  maxBoostDb: 12,
  maxCutDb: 12,
  // TTS "silence" carries breath and room tone near -55 dBFS; soft fricatives
  // ("three", "four", "six") start near -50 dBFS, so trim below that.
  silenceThresholdDb: -50,
  leadPadMs: 60,
  tailPadMs: 80,
} as const;

type Biquad = { b: [number, number, number]; a: [number, number, number] };

// libebur128's analog-prototype formulation; reproduces the published 48 kHz
// BS.1770 coefficients and adapts to the decoder's sample rate.
export function kWeightingFilters(sampleRate: number): [Biquad, Biquad] {
  let q = 0.7071752369554196;
  let k = Math.tan((Math.PI * 1681.974450955533) / sampleRate);
  const vh = 10 ** (3.999843853973347 / 20);
  const vb = vh ** 0.4996667741545416;
  let a0 = 1 + k / q + k * k;
  const shelf: Biquad = {
    b: [(vh + (vb * k) / q + k * k) / a0, (2 * (k * k - vh)) / a0, (vh - (vb * k) / q + k * k) / a0],
    a: [1, (2 * (k * k - 1)) / a0, (1 - k / q + k * k) / a0],
  };
  q = 0.5003270373238773;
  k = Math.tan((Math.PI * 38.13547087602444) / sampleRate);
  a0 = 1 + k / q + k * k;
  const highPass: Biquad = {
    b: [1, -2, 1],
    a: [1, (2 * (k * k - 1)) / a0, (1 - k / q + k * k) / a0],
  };
  return [shelf, highPass];
}

function filter(samples: Float32Array, { b, a }: Biquad) {
  const output = new Float32Array(samples.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let index = 0; index < samples.length; index += 1) {
    const x0 = samples[index];
    const y0 = b[0] * x0 + b[1] * x1 + b[2] * x2 - a[1] * y1 - a[2] * y2;
    x2 = x1; x1 = x0; y2 = y1; y1 = y0;
    output[index] = y0;
  }
  return output;
}

const blockLoudness = (meanSquare: number) => -0.691 + 10 * Math.log10(meanSquare);

/** Integrated loudness in LUFS, or -Infinity when nothing passes the gates. */
export function integratedLoudness(samples: Float32Array, sampleRate: number) {
  const [shelf, highPass] = kWeightingFilters(sampleRate);
  const weighted = filter(filter(samples, shelf), highPass);
  const blockSize = Math.round(0.4 * sampleRate);
  const hop = Math.round(0.1 * sampleRate);
  const blocks: number[] = [];
  const squareSum = (start: number, end: number) => {
    let sum = 0;
    for (let index = start; index < end; index += 1) sum += weighted[index] ** 2;
    return sum;
  };
  for (let start = 0; start + blockSize <= weighted.length; start += hop) {
    blocks.push(squareSum(start, start + blockSize) / blockSize);
  }
  // A clip shorter than one gating block is measured as a single block.
  if (!blocks.length && weighted.length) blocks.push(squareSum(0, weighted.length) / weighted.length);

  const aboveAbsolute = blocks.filter((meanSquare) => blockLoudness(meanSquare) > -70);
  if (!aboveAbsolute.length) return -Infinity;
  const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
  const relativeGate = blockLoudness(mean(aboveAbsolute)) - 10;
  const gated = aboveAbsolute.filter((meanSquare) => blockLoudness(meanSquare) > relativeGate);
  return blockLoudness(mean(gated));
}

export function samplePeak(samples: Float32Array) {
  let peak = 0;
  for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
  return peak;
}

/** Sample range that contains speech, padded so soft onsets survive. */
export function speechBounds(samples: Float32Array, sampleRate: number) {
  const threshold = 10 ** (VOICE_MASTERING.silenceThresholdDb / 20);
  let first = -1;
  let last = -1;
  for (let index = 0; index < samples.length; index += 1) {
    if (Math.abs(samples[index]) > threshold) {
      if (first < 0) first = index;
      last = index;
    }
  }
  if (first < 0) return null;
  return {
    start: Math.max(0, first - Math.round((VOICE_MASTERING.leadPadMs / 1000) * sampleRate)),
    end: Math.min(samples.length, last + 1 + Math.round((VOICE_MASTERING.tailPadMs / 1000) * sampleRate)),
  };
}

/** Linear gain toward the loudness target that never lifts a peak past the ceiling. */
export function normalizationGain(loudnessLufs: number, peak: number) {
  if (!Number.isFinite(loudnessLufs) || peak <= 0) return 1;
  const peakDb = 20 * Math.log10(peak);
  const gainDb = Math.max(
    -VOICE_MASTERING.maxCutDb,
    Math.min(
      VOICE_MASTERING.targetLufs - loudnessLufs,
      VOICE_MASTERING.peakCeilingDb - peakDb,
      VOICE_MASTERING.maxBoostDb,
    ),
  );
  return 10 ** (gainDb / 20);
}

/** Trim silence and compute a playback gain; null when the clip holds no speech. */
export function prepareVoiceSamples(samples: Float32Array, sampleRate: number) {
  const bounds = speechBounds(samples, sampleRate);
  if (!bounds) return null;
  const trimmed = samples.slice(bounds.start, bounds.end);
  return {
    samples: trimmed,
    gain: normalizationGain(integratedLoudness(trimmed, sampleRate), samplePeak(trimmed)),
    trimmedLeadMs: (bounds.start / sampleRate) * 1000,
  };
}
