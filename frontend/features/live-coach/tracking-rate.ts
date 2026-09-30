// Endpoint confirmation needs two samples near each turnaround. At 8 fps and
// above every analyzer still counts ~0.9 s reps; below it, fast reps are
// missed (never over-counted). The athlete should know when that applies.
export const TRACKING_RATE = {
  lowBelowFps: 8,
  // Hysteresis, so a rate hovering at the line does not flicker the warning.
  recoveredAtFps: 9.5,
  lowForMs: 3000,
  recoveredForMs: 2000,
  // The first seconds include model warm-up and a half-filled rate window.
  warmupMs: 3000,
} as const;

/** Sustained low analysis rate; brief dips (a GC pause, a notification) never trigger it. */
export class TrackingRateMonitor {
  private firstFrameMs: number | null = null;
  private low = false;
  private lowSince: number | null = null;
  private recoveredSince: number | null = null;

  get isLow() { return this.low; }

  reset() {
    this.firstFrameMs = null;
    this.low = false;
    this.lowSince = null;
    this.recoveredSince = null;
  }

  update(inferenceFps: number, timestampMs: number) {
    const R = TRACKING_RATE;
    this.firstFrameMs ??= timestampMs;
    // 0 means the rate window has one sample: no rate yet.
    if (!(inferenceFps > 0) || timestampMs - this.firstFrameMs < R.warmupMs) return this.low;
    if (inferenceFps < R.lowBelowFps) {
      this.recoveredSince = null;
      this.lowSince ??= timestampMs;
      if (timestampMs - this.lowSince >= R.lowForMs) this.low = true;
    } else {
      this.lowSince = null;
      if (inferenceFps >= R.recoveredAtFps) {
        this.recoveredSince ??= timestampMs;
        if (timestampMs - this.recoveredSince >= R.recoveredForMs) this.low = false;
      } else {
        this.recoveredSince = null;
      }
    }
    return this.low;
  }
}
