import type { LiveCoachCue, LiveCoachSnapshot } from "./types.ts";

export type VoicePlayback = { stop(): void };

/**
 * Playback engine. `onEnded` fires once, unless the clip is stopped: with
 * `true` after it played to the end, `false` when it could not play in time.
 */
export type VoiceOutput = {
  load(path: string): void;
  play(path: string, onEnded: (played: boolean) => void, maxDelayMs?: number): VoicePlayback;
  close(): void;
};

type ClipKind = "count" | "correction" | "setup" | "encouragement" | "session";

// Rep count → correction → setup → encouragement. Only a count may interrupt
// a clip of equal priority, so the newest count always wins.
const PRIORITY: Record<ClipKind, number> = {
  count: 100,
  correction: 60,
  setup: 40,
  encouragement: 20,
  session: 10,
};

export const VOICE_TIMING = {
  // Setup prompts must persist before speaking; one dropped frame is not a setup problem.
  setupPersistMs: 1000,
  setupGapMs: 4000,
  correctionGapMs: 6000,
  correctionRepeatMs: 15000,
  startCueRepeatMs: 30000,
  encouragementFirstRep: 3,
  encouragementEveryReps: 4,
  encouragementGapMs: 20000,
  encouragementQuietAfterCorrectionMs: 8000,
  // A count that cannot start promptly is skipped rather than spoken late.
  countMaxDelayMs: 700,
  countPreloadAhead: 5,
} as const;

export const MAX_SPOKEN_COUNT = 50;

const cueClips: Record<string, { path: string; kind: "correction" | "setup" }> = {
  "frame-body": { path: "setup/full-body-in-frame.mp3", kind: "setup" },
  "set-position": { path: "setup/hold-start-position.mp3", kind: "setup" },
  "finish-top": { path: "corrections/chin-over-bar.mp3", kind: "correction" },
  "extend-at-bottom": { path: "corrections/extend-at-bottom.mp3", kind: "correction" },
  "body-swing": { path: "corrections/reduce-the-swing.mp3", kind: "correction" },
  "push-frame-body": { path: "setup/full-body-in-frame.mp3", kind: "setup" },
  "push-set-position": { path: "setup/hold-start-position.mp3", kind: "setup" },
  // Reuse the bundled neutral recordings; no live speech generation needed.
  "go-lower": { path: "corrections/control-the-descent.mp3", kind: "correction" },
  "extend-arms": { path: "corrections/full-extension.mp3", kind: "correction" },
  "body-straight": { path: "corrections/brace-your-core.mp3", kind: "correction" },
};

export const SESSION_CLIPS = {
  getReady: "setup/get-ready.mp3",
  startWhenReady: "setup/start-when-ready.mp3",
  setComplete: "session/set-complete.mp3",
  goodEffort: "session/good-effort.mp3",
} as const;

// Neutral encouragement only: no clip claims control or quality the
// analyzer did not measure, and none sounds like the end of a set.
export const ENCOURAGEMENT_CLIPS = [
  "encouragement/keep-going.mp3",
  "encouragement/strong.mp3",
  "encouragement/stay-with-it.mp3",
  "encouragement/keep-pushing.mp3",
  "encouragement/youve-got-this.mp3",
] as const;

export function countClip(repCount: number): string | null {
  return Number.isInteger(repCount) && repCount >= 1 && repCount <= MAX_SPOKEN_COUNT
    ? `counts/${String(repCount).padStart(2, "0")}.mp3`
    : null;
}

export function correctionClip(cueId: string): string | null {
  const clip = cueClips[cueId];
  return clip?.kind === "correction" ? clip.path : null;
}

export function cueClip(cueId: string): string | null {
  return cueClips[cueId]?.path ?? null;
}

/** Every clip the coach can speak, for preloading and asset checks. */
export function spokenClipPaths(): string[] {
  const counts = Array.from({ length: MAX_SPOKEN_COUNT }, (_, index) => countClip(index + 1)!);
  return [...new Set([
    ...counts,
    ...Object.values(cueClips).map((clip) => clip.path),
    ...Object.values(SESSION_CLIPS),
    ...ENCOURAGEMENT_CLIPS,
  ])];
}

const SILENT_OUTPUT: VoiceOutput = {
  load() {},
  play(_path, onEnded) {
    onEnded(false);
    return { stop() {} };
  },
  close() {},
};

type Speaking = {
  kind: ClipKind;
  priority: number;
  playback: VoicePlayback | null;
  after: ((played: boolean) => void) | null;
};

export class LiveCoachVoice {
  private readonly output: VoiceOutput;
  private current: Speaking | null = null;
  private enabled = true;
  private closed = false;
  private closeWhenIdle = false;
  private lastFrameAt = -Infinity;
  private lastRepIndex = 0;
  private armed = false;
  private lastStartCueAt = -Infinity;
  private cueId = "";
  private cueSince = -Infinity;
  private cueHandled = true;
  private spokenSetup = new Set<string>();
  private lastSetupAt = -Infinity;
  private lastCorrectionAt = -Infinity;
  private lastCorrectionById = new Map<string, number>();
  private lastEncouragementAt = -Infinity;
  private lastEncouragementRep = -Infinity;
  private encouragementIndex = 0;
  private formFaultActive = false;

  constructor(output: VoiceOutput | null) {
    this.output = output ?? SILENT_OUTPUT;
  }

  preload() {
    for (let count = 1; count <= 10; count += 1) this.output.load(countClip(count)!);
    for (const path of spokenClipPaths()) {
      if (!path.startsWith("counts/")) this.output.load(path);
    }
  }

  setEnabled(enabled: boolean) {
    this.enabled = enabled;
    if (!enabled) this.stopCurrent();
  }

  start() {
    this.say(SESSION_CLIPS.getReady, "setup");
  }

  onFrame(snapshot: LiveCoachSnapshot, cue: LiveCoachCue, timestampMs: number) {
    if (this.closed || this.closeWhenIdle) return;
    this.lastFrameAt = timestampMs;
    this.formFaultActive = Boolean(snapshot.formFault);

    const rep = snapshot.latestRep;
    if (rep && rep.index > this.lastRepIndex) {
      this.lastRepIndex = rep.index;
      if (rep.outcome === "valid") this.countRep(snapshot.validRepCount);
    }

    // Speak once when counting becomes armed, e.g. at the first confirmed
    // hang and again when the athlete re-hangs after a rest.
    const armed = snapshot.phase !== "unknown";
    if (armed && !this.armed) {
      this.spokenSetup.clear();
      if (timestampMs - this.lastStartCueAt >= VOICE_TIMING.startCueRepeatMs &&
        this.say(SESSION_CLIPS.startWhenReady, "setup")) {
        this.lastStartCueAt = timestampMs;
        this.lastSetupAt = timestampMs;
      }
    }
    this.armed = armed;

    if (cue.id !== this.cueId) {
      this.cueId = cue.id;
      this.cueSince = timestampMs;
      this.cueHandled = false;
    }
    if (!this.cueHandled) this.considerCue(timestampMs);
  }

  /** Speak a closing line after any count in progress, then release audio. */
  finish(snapshot: Pick<LiveCoachSnapshot, "validRepCount" | "partialRepCount">) {
    if (this.closed) return;
    this.closeWhenIdle = true;
    const path = snapshot.validRepCount > 0
      ? SESSION_CLIPS.setComplete
      : snapshot.partialRepCount > 0 ? SESSION_CLIPS.goodEffort : null;
    const speakClosing = () => {
      if (!path || !this.say(path, "session")) this.close();
    };
    if (this.current?.kind === "count") {
      this.current.after = speakClosing;
    } else {
      this.stopCurrent();
      speakClosing();
    }
  }

  stop() {
    this.stopCurrent();
    this.close();
  }

  private countRep(count: number) {
    for (let next = count + 1; next <= Math.min(MAX_SPOKEN_COUNT, count + VOICE_TIMING.countPreloadAhead); next += 1) {
      this.output.load(countClip(next)!);
    }
    const path = countClip(count);
    if (!path) return;
    this.say(path, "count", (played) => {
      if (played) this.encourage(count);
    }, VOICE_TIMING.countMaxDelayMs);
  }

  // Runs only after a count was heard in full: a newer count interrupts
  // without firing `after`, so this never talks over the next rep.
  private encourage(count: number) {
    if (this.formFaultActive) return;
    const now = this.lastFrameAt;
    if (count < VOICE_TIMING.encouragementFirstRep ||
      count - this.lastEncouragementRep < VOICE_TIMING.encouragementEveryReps ||
      now - this.lastEncouragementAt < VOICE_TIMING.encouragementGapMs ||
      now - this.lastCorrectionAt < VOICE_TIMING.encouragementQuietAfterCorrectionMs) return;
    const path = ENCOURAGEMENT_CLIPS[this.encouragementIndex % ENCOURAGEMENT_CLIPS.length];
    if (this.say(path, "encouragement")) {
      this.encouragementIndex += 1;
      this.lastEncouragementRep = count;
      this.lastEncouragementAt = now;
    }
  }

  private considerCue(timestampMs: number) {
    const clip = cueClips[this.cueId];
    if (!clip) {
      this.cueHandled = true;
      return;
    }
    if (clip.kind === "correction") {
      const lastSame = this.lastCorrectionById.get(this.cueId) ?? -Infinity;
      if (timestampMs - lastSame < VOICE_TIMING.correctionRepeatMs) {
        this.cueHandled = true;
        return;
      }
      // Wait (while the cue persists) for the global gap or a count to end.
      if (timestampMs - this.lastCorrectionAt < VOICE_TIMING.correctionGapMs) return;
      if (!this.say(clip.path, "correction")) return;
      this.lastCorrectionAt = timestampMs;
      this.lastCorrectionById.set(this.cueId, timestampMs);
      this.cueHandled = true;
      return;
    }
    if (this.spokenSetup.has(clip.path)) {
      this.cueHandled = true;
      return;
    }
    if (timestampMs - this.cueSince < VOICE_TIMING.setupPersistMs ||
      timestampMs - this.lastSetupAt < VOICE_TIMING.setupGapMs) return;
    if (!this.say(clip.path, "setup")) return;
    this.lastSetupAt = timestampMs;
    this.spokenSetup.add(clip.path);
    this.cueHandled = true;
  }

  private canStart(kind: ClipKind) {
    return !this.current || PRIORITY[kind] > this.current.priority ||
      (kind === "count" && this.current.kind === "count");
  }

  private say(
    path: string,
    kind: ClipKind,
    after: ((played: boolean) => void) | null = null,
    maxDelayMs?: number,
  ) {
    if (!this.enabled || this.closed || !this.canStart(kind)) return false;
    this.stopCurrent();
    const speaking: Speaking = { kind, priority: PRIORITY[kind], playback: null, after };
    this.current = speaking;
    const playback = this.output.play(path, (played) => this.ended(speaking, played), maxDelayMs);
    if (this.current === speaking) speaking.playback = playback;
    return true;
  }

  private ended(speaking: Speaking, played: boolean) {
    if (this.current !== speaking) return;
    this.current = null;
    speaking.after?.(played);
    if (!this.current && this.closeWhenIdle) this.close();
  }

  private stopCurrent() {
    const speaking = this.current;
    this.current = null;
    try {
      speaking?.playback?.stop();
    } catch {
      // Audio is optional; analysis and counting continue.
    }
  }

  private close() {
    if (this.closed) return;
    this.closed = true;
    this.current = null;
    this.output.close();
  }
}
