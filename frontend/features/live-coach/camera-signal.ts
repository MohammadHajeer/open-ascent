// Checks what a camera stream actually delivers. A resolved getUserMedia() and
// play() only prove a stream exists: some virtual/phone cameras deliver frames
// that are one flat color (uninitialized buffers decode to solid green).

export type CameraSignal = "image" | "blank" | "no-frames";

export type FrameStats = {
  mean: [number, number, number];
  deviation: number;
};

type SignalVideo = Pick<HTMLVideoElement, "readyState" | "videoWidth" | "videoHeight">;

export type SignalProbe = {
  hasFrame: (video: SignalVideo) => boolean;
  sample: (video: SignalVideo) => FrameStats | null;
  wait: (ms: number) => Promise<void>;
};

// Real scenes, even dim ones, vary far more than this across a frame; a flat
// fill (green buffer, black placeholder, covered lens) varies by sensor noise at most.
const BLANK_DEVIATION = 4;

export function frameStats(rgba: ArrayLike<number>): FrameStats {
  const pixels = Math.floor(rgba.length / 4);
  const sum = [0, 0, 0];
  const squares = [0, 0, 0];
  for (let index = 0; index < pixels; index += 1) {
    for (let channel = 0; channel < 3; channel += 1) {
      const value = rgba[index * 4 + channel];
      sum[channel] += value;
      squares[channel] += value * value;
    }
  }
  const mean = sum.map((total) => total / Math.max(1, pixels)) as FrameStats["mean"];
  const deviation = Math.max(
    ...mean.map((average, channel) =>
      Math.sqrt(Math.max(0, squares[channel] / Math.max(1, pixels) - average * average)),
    ),
  );
  return { mean, deviation };
}

export function isBlankFrame(stats: FrameStats) {
  return stats.deviation < BLANK_DEVIATION;
}

/**
 * Waits for decoded frames, then samples a short window. One non-uniform frame
 * is enough to call it an image, so a normal webcam returns almost at once;
 * the window only matters for cameras that open on a few dark frames.
 */
export async function checkCameraSignal(
  video: SignalVideo,
  probe: SignalProbe,
  { firstFrameTimeoutMs = 4000, windowMs = 1600, intervalMs = 200 } = {},
): Promise<{ signal: CameraSignal; stats: FrameStats | null }> {
  let waited = 0;
  while (!probe.hasFrame(video)) {
    if (waited >= firstFrameTimeoutMs) return { signal: "no-frames", stats: null };
    await probe.wait(50);
    waited += 50;
  }

  let stats: FrameStats | null = null;
  for (let elapsed = 0; elapsed <= windowMs; elapsed += intervalMs) {
    stats = probe.sample(video) ?? stats;
    if (stats && !isBlankFrame(stats)) return { signal: "image", stats };
    await probe.wait(intervalMs);
  }
  return { signal: stats ? "blank" : "no-frames", stats };
}

/** Browser probe: reads a tiny downscaled copy of the current video frame. */
export function createCanvasSignalProbe(): SignalProbe {
  let context: CanvasRenderingContext2D | null = null;
  return {
    hasFrame: (video) => video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0,
    sample: (video) => {
      if (!context) {
        const canvas = document.createElement("canvas");
        canvas.width = 48;
        canvas.height = 27;
        context = canvas.getContext("2d", { willReadFrequently: true });
      }
      if (!context || video.videoWidth === 0) return null;
      try {
        context.drawImage(video as HTMLVideoElement, 0, 0, 48, 27);
        return frameStats(context.getImageData(0, 0, 48, 27).data);
      } catch {
        return null;
      }
    },
    wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  };
}
