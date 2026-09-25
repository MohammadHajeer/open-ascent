import { prepareVoiceSamples } from "./voice-loudness.ts";
import type { VoiceOutput } from "./voice.ts";

export const VOICE_ROOT = "/live-coach/voice";

type PreparedClip = { buffer: AudioBuffer; gain: number };
type AudioSessionNavigator = Navigator & { audioSession?: { type: string } };

/**
 * Web Audio playback for the bundled voice clips. Clips are decoded once,
 * trimmed of padding silence, and loudness-normalized so counts start
 * immediately and play at a consistent level. Create it inside the Start
 * click: mobile browsers only unlock audio from a user gesture.
 */
export function createWebAudioVoiceOutput(): VoiceOutput | null {
  const AudioContextClass = globalThis.AudioContext ??
    (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextClass) return null;
  let context: AudioContext;
  try {
    context = new AudioContextClass({ latencyHint: "interactive" });
  } catch {
    return null;
  }

  // iOS mutes Web Audio under the ring/silent switch unless the page asks for
  // playback, matching how the previous <audio> elements behaved.
  const audioSession = (navigator as AudioSessionNavigator).audioSession;
  const previousSessionType = audioSession?.type;
  try {
    if (audioSession) audioSession.type = "playback";
  } catch {
    // Unsupported session types are ignored.
  }
  void context.resume().catch(() => {});
  try {
    const unlock = context.createBufferSource();
    unlock.buffer = context.createBuffer(1, 1, context.sampleRate);
    unlock.connect(context.destination);
    unlock.start();
  } catch {
    // Playback stays optional.
  }

  const ready = new Map<string, PreparedClip | null>();
  const loading = new Map<string, Promise<PreparedClip | null>>();
  let closed = false;

  function prepare(decoded: AudioBuffer): PreparedClip | null {
    let samples = decoded.getChannelData(0);
    if (decoded.numberOfChannels > 1) {
      samples = samples.slice();
      for (let channel = 1; channel < decoded.numberOfChannels; channel += 1) {
        const other = decoded.getChannelData(channel);
        for (let index = 0; index < samples.length; index += 1) samples[index] += other[index];
      }
      for (let index = 0; index < samples.length; index += 1) samples[index] /= decoded.numberOfChannels;
    }
    const prepared = prepareVoiceSamples(samples, decoded.sampleRate);
    if (!prepared) return null;
    const buffer = context.createBuffer(1, prepared.samples.length, decoded.sampleRate);
    buffer.copyToChannel(prepared.samples, 0);
    return { buffer, gain: prepared.gain };
  }

  function load(path: string) {
    const cached = ready.get(path);
    if (cached !== undefined) return Promise.resolve(cached);
    let pending = loading.get(path);
    if (!pending) {
      pending = fetch(`${VOICE_ROOT}/${path}`)
        .then((response) => {
          if (!response.ok) throw new Error(`Voice clip unavailable: ${path}`);
          return response.arrayBuffer();
        })
        .then((bytes) => context.decodeAudioData(bytes))
        .then(prepare)
        .catch(() => null)
        .then((prepared) => {
          ready.set(path, prepared);
          loading.delete(path);
          return prepared;
        });
      loading.set(path, pending);
    }
    return pending;
  }

  return {
    load(path) {
      if (!closed) void load(path);
    },
    play(path, onEnded, maxDelayMs = 1500) {
      const requestedAt = performance.now();
      let source: AudioBufferSourceNode | null = null;
      let finished = false;
      const finish = (played: boolean) => {
        if (finished) return;
        finished = true;
        onEnded(played);
      };
      const start = (clip: PreparedClip | null) => {
        if (finished || closed) return;
        if (!clip || performance.now() - requestedAt > maxDelayMs) {
          finish(false);
          return;
        }
        if (context.state !== "running") void context.resume().catch(() => {});
        const gain = context.createGain();
        gain.gain.value = clip.gain;
        source = context.createBufferSource();
        source.buffer = clip.buffer;
        source.connect(gain).connect(context.destination);
        source.onended = () => {
          gain.disconnect();
          finish(true);
        };
        source.start();
      };
      const cached = ready.get(path);
      if (cached !== undefined) start(cached);
      else void load(path).then(start);
      return {
        stop() {
          if (finished) return;
          finished = true;
          try {
            source?.stop();
          } catch {
            // Already stopped.
          }
        },
      };
    },
    close() {
      if (closed) return;
      closed = true;
      ready.clear();
      loading.clear();
      void context.close().catch(() => {});
      try {
        if (audioSession && previousSessionType) audioSession.type = previousSessionType;
      } catch {
        // Ignore restore failures.
      }
    },
  };
}
