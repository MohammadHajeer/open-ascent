export const RECORDING_BIT_RATE = 2_500_000;

const RECORDING_TYPES = [
  "video/mp4;codecs=avc1.42E01E",
  "video/mp4",
  "video/webm;codecs=vp8",
  "video/webm",
] as const;

export function selectRecordingMimeType(
  isTypeSupported: (mimeType: string) => boolean,
): string | null {
  return RECORDING_TYPES.find(isTypeSupported) ?? null;
}

export function recordingFileExtension(mimeType: string): "mp4" | "webm" {
  return mimeType.startsWith("video/mp4") ? "mp4" : "webm";
}

export function formatRecordingTime(milliseconds: number): string {
  const seconds = Math.min(20, Math.max(0, Math.floor(milliseconds / 1000)));
  return `00:${String(seconds).padStart(2, "0")}`;
}

export function guestCameraConstraints(deviceId?: string): MediaStreamConstraints {
  return {
    audio: false,
    video: {
      ...(deviceId
        ? { deviceId: { exact: deviceId } }
        : { facingMode: { ideal: "user" } }),
      width: { ideal: 1280, max: 1280 },
      height: { ideal: 720, max: 720 },
      frameRate: { ideal: 30, max: 30 },
    },
  };
}

export function stopMediaStream(stream: MediaStream | null): void {
  stream?.getTracks().forEach((track) => track.stop());
}

export function cameraErrorMessage(error: unknown): string {
  if (error instanceof DOMException) {
    if (error.name === "NotAllowedError" || error.name === "SecurityError") {
      return "Camera access was denied. Allow camera access in your browser settings and try again.";
    }
    if (error.name === "NotFoundError" || error.name === "OverconstrainedError") {
      return "No available camera was found on this device.";
    }
    if (error.name === "NotReadableError" || error.name === "AbortError") {
      return "The camera is unavailable or already in use by another application.";
    }
  }
  return "The camera could not be started. Check your browser permissions and try again.";
}

export function startRecordingDeadline({
  maxDurationMs,
  startedAt,
  now,
  onTick,
  onDeadline,
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
}: {
  maxDurationMs: number;
  startedAt: number;
  now: () => number;
  onTick: (elapsedMs: number) => void;
  onDeadline: () => void;
  setIntervalFn?: typeof setInterval;
  clearIntervalFn?: typeof clearInterval;
  setTimeoutFn?: typeof setTimeout;
  clearTimeoutFn?: typeof clearTimeout;
}) {
  const interval = setIntervalFn(() => {
    onTick(Math.min(maxDurationMs, now() - startedAt));
  }, 200);
  const timeout = setTimeoutFn(onDeadline, maxDurationMs);
  return () => {
    clearIntervalFn(interval);
    clearTimeoutFn(timeout);
  };
}
