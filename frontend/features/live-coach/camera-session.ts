import type { CameraSignal, FrameStats } from "./camera-signal.ts";
import type { PoseRuntime } from "./mediapipe-pose.ts";
import type { PoseLandmark } from "./types.ts";

type VideoTarget = Pick<
  HTMLVideoElement,
  "srcObject" | "play" | "pause" | "readyState"
>;

type SessionDependencies = {
  getUserMedia: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
  createPoseRuntime: () => Promise<PoseRuntime>;
  requestFrame: (callback: FrameRequestCallback) => number;
  cancelFrame: (handle: number) => void;
  now: () => number;
  /** Verifies the attached stream shows an image; omitted means trust the stream. */
  checkSignal?: (video: VideoTarget) => Promise<{ signal: CameraSignal; stats: FrameStats | null }>;
};

export type CameraTier = "preferred" | "native" | "basic";

export type CameraAttempt = {
  tier: CameraTier;
  signal: CameraSignal | "unavailable";
  width?: number;
  height?: number;
  frameRate?: number;
  mean?: FrameStats["mean"];
};

// Every tier keeps the same device. "preferred" asks for HD; "native" takes the
// device's own default mode; "basic" asks for SD, which the most drivers fill.
// Later tiers run only when an earlier one delivered no usable image.
const CAMERA_TIERS: { tier: CameraTier; size: MediaTrackConstraints }[] = [
  { tier: "preferred", size: { width: { ideal: 1280 }, height: { ideal: 720 } } },
  { tier: "native", size: {} },
  { tier: "basic", size: { width: { ideal: 640 }, height: { ideal: 480 } } },
];

export type LiveFrame = {
  landmarks: PoseLandmark[] | null;
  timestampMs: number;
  inferenceMs: number;
  inferenceFps: number;
  delegate: "GPU" | "CPU";
};

export const CAMERA_DISCONNECTED = "The camera disconnected.";

export class LiveCoachSessionError extends Error {
  readonly stage: "camera" | "mediapipe" | "inference";

  constructor(
    stage: "camera" | "mediapipe" | "inference",
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "LiveCoachSessionError";
    this.stage = stage;
  }
}

type SessionCallbacks = {
  onFrame: (frame: LiveFrame) => void;
  /** A stream is attached; its frames are being checked. */
  onCameraConnected?: () => void;
  onCameraReady?: (signal: CameraSignal) => void;
  onError?: (error: LiveCoachSessionError) => void;
};

export class LiveCoachCameraSession {
  private readonly dependencies: SessionDependencies;
  private readonly targetInferenceFps: number;
  private stream: MediaStream | null = null;
  private runtime: PoseRuntime | null = null;
  private frameHandle: number | null = null;
  private generation = 0;
  private lastInferenceAt = -Infinity;
  private inferenceTimes: number[] = [];
  private video: VideoTarget | null = null;

  constructor(dependencies: SessionDependencies, targetInferenceFps = 12) {
    this.dependencies = dependencies;
    this.targetInferenceFps = targetInferenceFps;
  }

  async start(
    video: VideoTarget,
    callbacks: SessionCallbacks,
    deviceId?: string,
  ) {
    this.stop();
    const generation = this.generation;
    const initializationStartedAt = this.dependencies.now();
    this.video = video;
    const attempts: CameraAttempt[] = [];
    // Pinned after the first open, so fallback tiers can never drift to another camera.
    let pinnedDeviceId = deviceId;
    let firstOpened: { tier: CameraTier; constraints: MediaStreamConstraints } | null = null;
    let openedTier: CameraTier | null = null;
    let signal: CameraSignal = "image";

    try {
      for (const [index, { tier, size }] of CAMERA_TIERS.entries()) {
        const constraints: MediaStreamConstraints = {
          audio: false,
          video: pinnedDeviceId
            ? { deviceId: { exact: pinnedDeviceId }, ...size }
            : { facingMode: { ideal: "user" }, ...size },
        };
        let stream: MediaStream;
        try {
          stream = await this.dependencies.getUserMedia(constraints);
        } catch (error) {
          if (!firstOpened) {
            throw new LiveCoachSessionError(
              "camera",
              "The camera could not be started.",
              { cause: error },
            );
          }
          attempts.push({ tier, signal: "unavailable" });
          break;
        }
        if (generation !== this.generation) {
          stopStream(stream);
          return null;
        }

        await this.attach(video, stream, callbacks, generation);
        if (generation !== this.generation) return null;
        firstOpened ??= { tier, constraints };
        openedTier = tier;
        const settings = stream.getVideoTracks()[0]?.getSettings();
        pinnedDeviceId ??= settings?.deviceId || undefined;
        if (index === 0) callbacks.onCameraConnected?.();

        const check = this.dependencies.checkSignal
          ? await this.dependencies.checkSignal(video)
          : { signal: "image" as const, stats: null };
        if (generation !== this.generation) return null;
        signal = check.signal;
        attempts.push({
          tier,
          signal,
          width: settings?.width,
          height: settings?.height,
          frameRate: settings?.frameRate,
          mean: check.stats?.mean,
        });
        if (signal === "image" || index === CAMERA_TIERS.length - 1) break;
        this.detach();
        openedTier = null;
      }

      // No mode showed a picture, so the mode isn't the cause (an idle source,
      // a covered lens). Settle on the first, highest-quality mode that opened;
      // the live check clears the warning if a picture arrives later. This also
      // covers a fallback mode that failed to open after the last was released.
      if (firstOpened && openedTier !== firstOpened.tier && (signal !== "image" || openedTier === null)) {
        this.detach();
        const stream = await this.dependencies.getUserMedia(firstOpened.constraints);
        if (generation !== this.generation) {
          stopStream(stream);
          return null;
        }
        await this.attach(video, stream, callbacks, generation);
        if (generation !== this.generation) return null;
        openedTier = firstOpened.tier;
      }
      callbacks.onCameraReady?.(signal);

      let runtime: PoseRuntime;
      try {
        runtime = await this.dependencies.createPoseRuntime();
      } catch (error) {
        throw new LiveCoachSessionError(
          "mediapipe",
          "MediaPipe Pose could not be initialized.",
          { cause: error },
        );
      }
      if (generation !== this.generation) {
        runtime.close();
        return null;
      }
      this.runtime = runtime;
      this.schedule(callbacks, generation);

      const activeTrack = this.stream?.getVideoTracks()[0];
      const settings = activeTrack?.getSettings();
      return {
        delegate: runtime.delegate,
        facingMode: settings?.facingMode ?? null,
        deviceId: settings?.deviceId ?? null,
        deviceLabel: activeTrack?.label ?? "",
        signal,
        tier: openedTier ?? "preferred",
        width: settings?.width ?? null,
        height: settings?.height ?? null,
        frameRate: settings?.frameRate ?? null,
        attempts,
        initializationMs:
          this.dependencies.now() - initializationStartedAt,
      };
    } catch (error) {
      this.stop();
      if (error instanceof LiveCoachSessionError) throw error;
      throw new LiveCoachSessionError(
        "camera",
        "The camera preview could not be initialized.",
        { cause: error },
      );
    }
  }

  private async attach(
    video: VideoTarget,
    stream: MediaStream,
    callbacks: SessionCallbacks,
    generation: number,
  ) {
    this.stream = stream;
    // "ended" fires when the device goes away (unplugged phone, closed virtual
    // camera), never for our own track.stop(); without it the preview freezes.
    stream.getVideoTracks()[0]?.addEventListener?.("ended", () => {
      if (generation !== this.generation || this.stream !== stream) return;
      this.stop();
      callbacks.onError?.(new LiveCoachSessionError("camera", CAMERA_DISCONNECTED));
    });
    video.srcObject = stream;
    await video.play();
  }

  /** Releases the current stream's tracks and preview before another open. */
  private detach() {
    if (this.stream) stopStream(this.stream);
    this.stream = null;
    if (this.video) {
      this.video.pause();
      this.video.srcObject = null;
    }
  }

  stop() {
    this.generation += 1;
    if (this.frameHandle !== null) {
      this.dependencies.cancelFrame(this.frameHandle);
      this.frameHandle = null;
    }
    this.runtime?.close();
    this.runtime = null;
    if (this.stream) stopStream(this.stream);
    this.stream = null;
    if (this.video) {
      this.video.pause();
      this.video.srcObject = null;
    }
    this.video = null;
    this.lastInferenceAt = -Infinity;
    this.inferenceTimes = [];
  }

  private schedule(callbacks: SessionCallbacks, generation: number) {
    const tick: FrameRequestCallback = () => {
      if (
        generation !== this.generation ||
        !this.runtime ||
        !this.video
      ) {
        return;
      }

      const timestampMs = this.dependencies.now();
      const intervalMs = 1000 / this.targetInferenceFps;
      if (
        this.video.readyState >= 2 &&
        timestampMs - this.lastInferenceAt >= intervalMs
      ) {
        const startedAt = this.dependencies.now();
        let landmarks: PoseLandmark[] | null;
        try {
          landmarks = this.runtime.detect(
            this.video as HTMLVideoElement,
            timestampMs,
          );
        } catch (error) {
          const sessionError = new LiveCoachSessionError(
            "inference",
            "Pose inference stopped unexpectedly.",
            { cause: error },
          );
          callbacks.onError?.(sessionError);
          this.stop();
          return;
        }
        const inferenceMs = this.dependencies.now() - startedAt;
        this.lastInferenceAt = timestampMs;
        this.inferenceTimes.push(timestampMs);
        this.inferenceTimes = this.inferenceTimes.filter(
          (sample) => timestampMs - sample <= 2000,
        );
        const duration = Math.max(
          1,
          timestampMs - (this.inferenceTimes[0] ?? timestampMs),
        );
        const inferenceFps =
          this.inferenceTimes.length <= 1
            ? 0
            : ((this.inferenceTimes.length - 1) * 1000) / duration;
        callbacks.onFrame({
          landmarks,
          timestampMs,
          inferenceMs,
          inferenceFps,
          delegate: this.runtime.delegate,
        });
      }

      this.frameHandle = this.dependencies.requestFrame(tick);
    };

    this.frameHandle = this.dependencies.requestFrame(tick);
  }
}

function stopStream(stream: MediaStream) {
  for (const track of stream.getTracks()) track.stop();
}
