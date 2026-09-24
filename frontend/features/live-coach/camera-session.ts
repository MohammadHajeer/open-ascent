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
};

export type LiveFrame = {
  landmarks: PoseLandmark[] | null;
  timestampMs: number;
  inferenceMs: number;
  inferenceFps: number;
  delegate: "GPU" | "CPU";
};

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
  onCameraReady?: () => void;
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

    let stream: MediaStream;
    try {
      stream = await this.dependencies.getUserMedia({
        audio: false,
        video: deviceId
          ? { deviceId: { exact: deviceId }, width: { ideal: 1280 }, height: { ideal: 720 } }
          : { facingMode: { ideal: "user" }, width: { ideal: 1280 }, height: { ideal: 720 } },
      });
    } catch (error) {
      const sessionError = new LiveCoachSessionError(
        "camera",
        "The camera could not be started.",
        { cause: error },
      );
      this.stop();
      throw sessionError;
    }

    try {
      if (generation !== this.generation) {
        stopStream(stream);
        return null;
      }

      this.stream = stream;
      video.srcObject = stream;
      await video.play();
      if (generation !== this.generation) {
        return null;
      }
      callbacks.onCameraReady?.();

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
        stopStream(stream);
        return null;
      }
      this.runtime = runtime;
      this.schedule(callbacks, generation);

      const activeTrack = stream.getVideoTracks()[0];
      const settings = activeTrack?.getSettings();
      return {
        delegate: runtime.delegate,
        facingMode: settings?.facingMode ?? null,
        deviceId: settings?.deviceId ?? null,
        deviceLabel: activeTrack?.label ?? "",
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
