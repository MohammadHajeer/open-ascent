import type { LiveCoachCue, PullUpSnapshot } from "./types.ts";

type VoiceClip = {
  preload: string;
  currentTime: number;
  onended: ((event: Event) => void) | null;
  load(): void;
  pause(): void;
  play(): Promise<void>;
};

type VoiceFactory = (path: string) => VoiceClip;

const ROOT = "/live-coach/voice";
const cueClips: Record<string, string> = {
  "frame-body": "setup/full-body-in-frame.mp3",
  "set-position": "setup/hold-start-position.mp3",
  "hold-start": "setup/hold-start-position.mp3",
  "finish-top": "corrections/chin-over-bar.mp3",
  "control-lowering": "corrections/control-the-descent.mp3",
};

export function countClip(repCount: number): string | null {
  return Number.isInteger(repCount) && repCount >= 1 && repCount <= 50
    ? `counts/${String(repCount).padStart(2, "0")}.mp3`
    : null;
}

export function correctionClip(cueId: string): string | null {
  const path = cueClips[cueId];
  return path?.startsWith("corrections/") ? path : null;
}

export class LiveCoachVoice {
  private readonly createClip: VoiceFactory;
  private clips = new Map<string, VoiceClip>();
  private current: VoiceClip | null = null;
  private currentPriority = 0;
  private lastRepIndex = 0;
  private lastCueId = "";
  private lastCorrectionAt = -Infinity;
  private lastSetupAt = -Infinity;
  private enabled = true;

  constructor(createClip: VoiceFactory) {
    this.createClip = createClip;
  }

  preload() {
    for (let count = 1; count <= 10; count += 1) {
      this.getClip(countClip(count)!);
    }
    for (const path of new Set(Object.values(cueClips))) this.getClip(path);
    this.getClip("setup/get-ready.mp3");
    this.getClip("session/set-complete.mp3");
  }

  setEnabled(enabled: boolean) {
    this.enabled = enabled;
    if (!enabled) this.stopAudio();
  }

  start() {
    this.lastRepIndex = 0;
    this.lastCueId = "";
    this.lastCorrectionAt = -Infinity;
    this.lastSetupAt = -Infinity;
    this.playClip("setup/get-ready.mp3", 20);
  }

  onFrame(snapshot: PullUpSnapshot, cue: LiveCoachCue, timestampMs: number) {
    const rep = snapshot.latestRep;
    if (rep && rep.index > this.lastRepIndex) {
      this.lastRepIndex = rep.index;
      if (rep.outcome === "valid") {
        const path = countClip(snapshot.validRepCount);
        if (path) this.playClip(path, 100);
        for (let count = snapshot.validRepCount + 1;
          count <= Math.min(50, snapshot.validRepCount + 5); count += 1) {
          this.getClip(countClip(count)!);
        }
      }
    }

    if (cue.id === this.lastCueId) return;
    this.lastCueId = cue.id;
    const path = cueClips[cue.id];
    if (!path) return;
    if (path.startsWith("corrections/")) {
      if (timestampMs - this.lastCorrectionAt < 6000) return;
      this.lastCorrectionAt = timestampMs;
      this.playClip(path, 50);
    } else if (timestampMs - this.lastSetupAt >= 5000) {
      this.lastSetupAt = timestampMs;
      this.playClip(path, 20);
    }
  }

  finish() {
    this.playClip("session/set-complete.mp3", 10);
  }

  stop() {
    this.stopAudio();
    this.lastCueId = "";
  }

  private getClip(path: string): VoiceClip | null {
    const cached = this.clips.get(path);
    if (cached) return cached;
    try {
      const clip = this.createClip(`${ROOT}/${path}`);
      clip.preload = "auto";
      clip.load();
      this.clips.set(path, clip);
      return clip;
    } catch {
      return null;
    }
  }

  private playClip(path: string, priority: number) {
    if (!this.enabled || (this.current && priority < this.currentPriority)) return;
    const clip = this.getClip(path);
    if (!clip) return;
    this.stopAudio();
    this.current = clip;
    this.currentPriority = priority;
    clip.onended = () => {
      if (this.current === clip) {
        this.current = null;
        this.currentPriority = 0;
      }
    };
    try {
      clip.currentTime = 0;
      void clip.play().catch(() => {
        if (this.current === clip) this.stopAudio();
      });
    } catch {
      this.stopAudio();
    }
  }

  private stopAudio() {
    if (this.current) {
      try {
        this.current.pause();
        this.current.currentTime = 0;
        this.current.onended = null;
      } catch {
        // Audio is optional; analysis and counting continue.
      }
    }
    this.current = null;
    this.currentPriority = 0;
  }
}
