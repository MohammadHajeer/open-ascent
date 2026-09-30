import type { CameraSignal, FrameStats } from "./camera-signal.ts";
import type { PoseRuntime } from "./mediapipe-pose.ts";
import type { PoseLandmark } from "./types.ts";

type VideoTarget = Pick<
  HTMLVideoElement,
  "srcObject" | "play" | "pause" | "readyState"
>;

/** What the browser reports about a newly presented camera frame. */
export type VideoFrameInfo = {
  /** Increases with every frame the video element presents. */
  presentedFrames: number;
  /** When the camera captured the frame, on the performance.now() clock. */
  captureTime?: number;
};

type SessionDependencies = {
  getUserMedia: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
  createPoseRuntime: () => Promise<PoseRuntime>;
  requestFrame: (callback: FrameRequestCallback) => number;
  cancelFrame: (handle: number) => void;
  now: () => number;
  /**
   * requestVideoFrameCallback, where supported: calls back once per new camera
   * frame. Omitted, analysis samples the video on animation frames instead.
   */
  requestVideoFrame?: (video: VideoTarget, callback: (nowMs: number, frame: VideoFrameInfo) => void) => number;
  cancelVideoFrame?: (video: VideoTarget, handle: number) => void;
  /** Verifies the attached stream shows an image; omitted means trust the stream. */
  checkSignal?: (video: VideoTarget) => Promise<{ signal: CameraSignal; stats: FrameStats | null }>;
};

export type CameraTier = "preferred" | "native" | "basic";

/** Which way the camera faces when no specific device is chosen. */
export type CameraFacing = "user" | "environment";

// A browser that lists requestVideoFrameCallback but never calls it for a
// camera stream must not leave the session silently unanalyzed.
export const VIDEO_FRAME_WATCHDOG_MS = 1500;

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
  private cancelScheduled: (() => void) | null = null;
  private generation = 0;
  private nextInferenceDueMs: number | null = null;
  private lastFrameTimestampMs = -Infinity;
  private lastPresentedFrames = -Infinity;
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
    facingMode: CameraFacing = "user",
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
            : { facingMode: { ideal: facingMode }, ...size },
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
    this.cancelScheduled?.();
    this.cancelScheduled = null;
    this.runtime?.close();
    this.runtime = null;
    if (this.stream) stopStream(this.stream);
    this.stream = null;
    if (this.video) {
      this.video.pause();
      this.video.srcObject = null;
    }
    this.video = null;
    this.nextInferenceDueMs = null;
    this.lastFrameTimestampMs = -Infinity;
    this.lastPresentedFrames = -Infinity;
    this.inferenceTimes = [];
  }

  /**
   * Drives analysis from new camera frames when the browser reports them, so
   * one frame is never analyzed twice (a phone camera can drop to 15 fps or
   * less in dim light, below the inference target) and each result carries
   * the frame's own capture time. Otherwise samples on animation frames.
   */
  private schedule(callbacks: SessionCallbacks, generation: number) {
    const { requestVideoFrame, cancelVideoFrame, requestFrame, cancelFrame, now } = this.dependencies;
    const video = this.video;
    if (!video) return;
    const live = () => generation === this.generation && this.runtime !== null;
    let videoFrameHandle: number | null = null;
    let animationFrameHandle: number | null = null;
    this.cancelScheduled = () => {
      if (videoFrameHandle !== null) cancelVideoFrame?.(video, videoFrameHandle);
      if (animationFrameHandle !== null) cancelFrame(animationFrameHandle);
      videoFrameHandle = null;
      animationFrameHandle = null;
    };

    // "pending" until the first video frame callback arrives or the watchdog gives up.
    let videoFrames: "pending" | "working" | "failed" = requestVideoFrame ? "pending" : "failed";
    let watchdogFrom: number | null = null;

    const onVideoFrame = (nowMs: number, frame: VideoFrameInfo) => {
      videoFrameHandle = null;
      if (!live() || videoFrames === "failed") return;
      videoFrames = "working";
      if (frame.presentedFrames > this.lastPresentedFrames) {
        this.lastPresentedFrames = frame.presentedFrames;
        const captured = frame.captureTime;
        const timestampMs = typeof captured === "number" && Number.isFinite(captured) ? captured : nowMs;
        if (!this.analyze(timestampMs, callbacks)) return;
      }
      if (live() && requestVideoFrame) videoFrameHandle = requestVideoFrame(video, onVideoFrame);
    };

    const onAnimationFrame: FrameRequestCallback = () => {
      animationFrameHandle = null;
      if (!live() || videoFrames === "working") return;
      const timestampMs = now();
      if (videoFrames === "pending") {
        if (video.readyState >= 2) watchdogFrom ??= timestampMs;
        if (watchdogFrom === null || timestampMs - watchdogFrom < VIDEO_FRAME_WATCHDOG_MS) {
          animationFrameHandle = requestFrame(onAnimationFrame);
          return;
        }
        videoFrames = "failed";
        if (videoFrameHandle !== null) cancelVideoFrame?.(video, videoFrameHandle);
        videoFrameHandle = null;
      }
      if (!this.analyze(timestampMs, callbacks)) return;
      if (live()) animationFrameHandle = requestFrame(onAnimationFrame);
    };

    if (requestVideoFrame) videoFrameHandle = requestVideoFrame(video, onVideoFrame);
    animationFrameHandle = requestFrame(onAnimationFrame);
  }

  /** Runs pose inference on the current frame when one is due. False once the session has stopped. */
  private analyze(timestampMs: number, callbacks: SessionCallbacks) {
    const runtime = this.runtime;
    const video = this.video;
    if (!runtime || !video) return false;
    // MediaPipe needs strictly increasing timestamps; an older or repeated
    // stamp is a frame already analyzed.
    if (video.readyState < 2 || timestampMs <= this.lastFrameTimestampMs) return true;
    // Pace to the target rate on average (a 30 fps camera alternates 67 and
    // 100 ms rather than settling at 10 fps), without bursting after a stall.
    const intervalMs = 1000 / this.targetInferenceFps;
    const due = this.nextInferenceDueMs;
    // Frame times jitter; a frame within a millisecond of due is on time.
    if (due !== null && timestampMs < due - 1) return true;
    this.nextInferenceDueMs = due === null || timestampMs - due > intervalMs
      ? timestampMs + intervalMs
      : due + intervalMs;
    this.lastFrameTimestampMs = timestampMs;

    const startedAt = this.dependencies.now();
    let landmarks: PoseLandmark[] | null;
    try {
      landmarks = runtime.detect(video as HTMLVideoElement, timestampMs);
    } catch (error) {
      const sessionError = new LiveCoachSessionError(
        "inference",
        "Pose inference stopped unexpectedly.",
        { cause: error },
      );
      callbacks.onError?.(sessionError);
      this.stop();
      return false;
    }
    const inferenceMs = this.dependencies.now() - startedAt;
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
      delegate: runtime.delegate,
    });
    return true;
  }
}

function stopStream(stream: MediaStream) {
  for (const track of stream.getTracks()) track.stop();
}
