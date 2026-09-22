"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  Camera,
  CameraOff,
  Check,
  CircleAlert,
  Gauge,
  LockKeyhole,
  RefreshCw,
  ShieldCheck,
  Square,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  LiveCoachCameraSession,
  LiveCoachSessionError,
  type LiveFrame,
} from "@/features/live-coach/camera-session";
import { selectPrioritizedCue } from "@/features/live-coach/cues";
import { createMediaPipePoseRuntime } from "@/features/live-coach/mediapipe-pose";
import { LivePullUpAnalyzer } from "@/features/live-coach/pull-up-analyzer";
import { measurePullUpPose } from "@/features/live-coach/pull-up-semantics";
import type {
  LiveCoachCue,
  PoseLandmark,
  PullUpSnapshot,
} from "@/features/live-coach/types";
import { cn } from "@/lib/utils";
import { useSubscriptionStatus } from "@/features/subscription/hooks";

type SessionStatus =
  | "idle"
  | "requesting-camera"
  | "loading-pose"
  | "running"
  | "stopped"
  | "error";

type DeviceOption = { deviceId: string; label: string };

const INITIAL_SNAPSHOT: PullUpSnapshot = {
  phase: "unknown",
  validRepCount: 0,
  partialRepCount: 0,
  poseReady: false,
  setupReady: false,
  latestRep: null,
  observation: null,
};

const INITIAL_CUE = selectPrioritizedCue(INITIAL_SNAPSHOT);

const poseConnections = [
  [11, 12],
  [11, 13],
  [13, 15],
  [12, 14],
  [14, 16],
  [11, 23],
  [12, 24],
  [23, 24],
] as const;

export function LiveCoachWorkspace() {
  const subscription = useSubscriptionStatus();
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sessionRef = useRef<LiveCoachCameraSession | null>(null);
  const analyzerRef = useRef(new LivePullUpAnalyzer());

  const [status, setStatus] = useState<SessionStatus>("idle");
  const [safetyAcknowledged, setSafetyAcknowledged] = useState(false);
  const [snapshot, setSnapshot] = useState(INITIAL_SNAPSHOT);
  const [cue, setCue] = useState<LiveCoachCue>(INITIAL_CUE);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [devices, setDevices] = useState<DeviceOption[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState("");
  const [mirrorPreview, setMirrorPreview] = useState(true);
  const [fps, setFps] = useState(0);
  const [inferenceMs, setInferenceMs] = useState(0);
  const [initializationMs, setInitializationMs] = useState<number | null>(null);
  const [delegate, setDelegate] = useState<"GPU" | "CPU" | null>(null);

  const isActive =
    status === "requesting-camera" ||
    status === "loading-pose" ||
    status === "running";
  const hasLiveCoachAccess = subscription.data?.effective_plan === "pro";

  useEffect(() => () => sessionRef.current?.stop(), []);

  async function startSession() {
    if (!videoRef.current || !safetyAcknowledged || !hasLiveCoachAccess) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus("error");
      setErrorMessage(
        "This browser does not expose camera access. Use a current Chromium browser over HTTPS or localhost.",
      );
      return;
    }

    sessionRef.current?.stop();
    analyzerRef.current.reset();
    clearCanvas(canvasRef.current);
    setSnapshot(INITIAL_SNAPSHOT);
    setCue(INITIAL_CUE);
    setFps(0);
    setInferenceMs(0);
    setDelegate(null);
    setErrorMessage(null);
    setStatus("requesting-camera");

    const session = new LiveCoachCameraSession({
      getUserMedia: (constraints) =>
        navigator.mediaDevices.getUserMedia(constraints),
      createPoseRuntime: createMediaPipePoseRuntime,
      requestFrame: (callback) => requestAnimationFrame(callback),
      cancelFrame: (handle) => cancelAnimationFrame(handle),
      now: () => performance.now(),
    });
    sessionRef.current = session;

    try {
      const result = await session.start(
        videoRef.current,
        {
          onCameraReady: () => setStatus("loading-pose"),
          onFrame: handleFrame,
          onError: handleSessionError,
        },
        selectedDeviceId || undefined,
      );
      if (!result) return;
      setStatus("running");
      setDelegate(result.delegate);
      const rearFacingLabel = /\b(back|rear|environment)\b/i.test(
        result.deviceLabel,
      );
      setMirrorPreview(
        result.facingMode !== "environment" && !rearFacingLabel,
      );
      setInitializationMs(result.initializationMs);
      await refreshCameraList(result.deviceId);
    } catch (error) {
      handleSessionError(normalizeSessionError(error));
    }
  }

  function stopSession() {
    sessionRef.current?.stop();
    sessionRef.current = null;
    setStatus("stopped");
    setDelegate(null);
    clearCanvas(canvasRef.current);
  }

  function handleFrame(frame: LiveFrame) {
    drawPose(canvasRef.current, videoRef.current, frame.landmarks);
    const observation = frame.landmarks
      ? measurePullUpPose(frame.landmarks, frame.timestampMs)
      : null;
    const nextSnapshot = analyzerRef.current.update(
      observation,
      frame.timestampMs,
    );
    setSnapshot(nextSnapshot);
    setCue(selectPrioritizedCue(nextSnapshot));
    setFps(frame.inferenceFps);
    setInferenceMs(frame.inferenceMs);
  }

  function handleSessionError(error: LiveCoachSessionError) {
    sessionRef.current?.stop();
    sessionRef.current = null;
    setStatus("error");
    setDelegate(null);
    setErrorMessage(sessionErrorMessage(error));
    clearCanvas(canvasRef.current);
  }

  async function refreshCameraList(activeDeviceId: string | null) {
    try {
      const available = await navigator.mediaDevices.enumerateDevices();
      const videoInputs = available
        .filter((device) => device.kind === "videoinput")
        .map((device, index) => ({
          deviceId: device.deviceId,
          label: device.label || `Camera ${index + 1}`,
        }));
      setDevices(videoInputs);
      if (activeDeviceId) setSelectedDeviceId(activeDeviceId);
    } catch {
      // Camera enumeration is optional; the active stream can continue.
    }
  }

  const estimatedCueLatency = fps > 0 ? Math.round(1000 / fps + inferenceMs) : null;
  const phaseLabel = snapshot.phase === "unknown" ? "Finding start" : snapshot.phase;

  return (
    <div className="space-y-5">
      <section className="overflow-hidden rounded-[1.6rem] border border-border bg-card/70">
        <div className="grid lg:grid-cols-[minmax(0,1.55fr)_minmax(320px,0.7fr)]">
          <div className="relative min-h-[24rem] overflow-hidden bg-visual-surface lg:min-h-[36rem]">
            <div className="cv-grid pointer-events-none absolute inset-0 opacity-15" />
            <video
              ref={videoRef}
              className={cn(
                "absolute inset-0 size-full object-contain",
                mirrorPreview && "-scale-x-100",
              )}
              playsInline
              muted
              aria-label="Live camera preview"
            />
            <canvas
              ref={canvasRef}
              className={cn(
                "pointer-events-none absolute inset-0 size-full object-contain",
                mirrorPreview && "-scale-x-100",
              )}
              aria-hidden="true"
            />

            {!isActive ? (
              <div className="absolute inset-0 grid place-items-center p-8 text-center">
                <div className="max-w-md">
                  <span className="mx-auto flex size-14 items-center justify-center rounded-2xl border border-white/15 bg-white/5 text-primary">
                    {status === "stopped" ? (
                      <CameraOff className="size-6" />
                    ) : (
                      <Camera className="size-6" />
                    )}
                  </span>
                  <h2 className="mt-5 text-2xl font-medium tracking-[-0.04em] text-visual-foreground">
                    {status === "stopped"
                      ? "Camera is off."
                      : "Camera stays local until you start."}
                  </h2>
                  <p className="mt-2 text-sm leading-6 text-white/55">
                    Place the camera in front of the bar with your wrists,
                    shoulders, and hips visible through the full rep.
                  </p>
                </div>
              </div>
            ) : null}

            {status === "requesting-camera" || status === "loading-pose" ? (
              <div className="absolute inset-x-5 bottom-5 flex items-center gap-3 rounded-2xl border border-white/10 bg-black/55 px-4 py-3 text-sm text-white backdrop-blur">
                <RefreshCw className="size-4 animate-spin text-primary" />
                {status === "requesting-camera"
                  ? "Waiting for camera permission…"
                  : "Camera ready. Loading local pose model…"}
              </div>
            ) : null}

            <div className="absolute top-4 left-4 flex flex-wrap gap-2">
              <StatusPill
                ready={status === "running"}
                label={status === "running" ? "Pose live" : "Pose offline"}
              />
              <span className="rounded-full border border-white/10 bg-black/45 px-3 py-1.5 font-mono text-[0.58rem] tracking-[0.12em] text-white/70 uppercase backdrop-blur">
                Local inference
              </span>
            </div>
          </div>

          <aside className="flex flex-col border-t border-border lg:border-t-0 lg:border-l">
            <div className="border-b border-border p-5 sm:p-6">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="font-mono text-[0.56rem] font-semibold tracking-[0.14em] text-primary uppercase">
                    Selected movement
                  </p>
                  <h2 className="mt-1 text-2xl font-medium tracking-[-0.04em]">
                    Pull-Up
                  </h2>
                </div>
                <span className="rounded-full border border-primary/20 bg-primary-light px-3 py-1 font-mono text-[0.56rem] font-semibold tracking-[0.11em] text-primary uppercase">
                  One movement
                </span>
              </div>
            </div>

            <div className="grid grid-cols-2 border-b border-border">
              <Metric label="Completed reps" value={String(snapshot.validRepCount)} />
              <Metric label="Current phase" value={phaseLabel} capitalize />
            </div>

            <div className="flex-1 p-5 sm:p-6">
              <p className="font-mono text-[0.56rem] font-semibold tracking-[0.14em] text-primary uppercase">
                Live cue · highest priority
              </p>
              <div
                className={cn(
                  "mt-3 rounded-2xl border p-5",
                  cue.tone === "attention"
                    ? "border-amber-700/30 bg-amber-500/8"
                    : "border-primary/20 bg-primary-light",
                )}
                role="status"
                aria-live="polite"
              >
                <div className="flex items-start gap-3">
                  {cue.tone === "attention" ? (
                    <CircleAlert className="mt-0.5 size-5 shrink-0 text-amber-700 dark:text-amber-400" />
                  ) : (
                    <Check className="mt-0.5 size-5 shrink-0 text-primary" />
                  )}
                  <div>
                    <p className="font-medium">{cue.title}</p>
                    <p className="mt-1 text-sm leading-6 text-foreground-soft">
                      {cue.detail}
                    </p>
                  </div>
                </div>
              </div>

              {errorMessage ? (
                <p className="mt-4 rounded-xl border border-destructive/25 bg-destructive/5 p-3 text-sm leading-5 text-destructive">
                  {errorMessage}
                </p>
              ) : null}

              {!hasLiveCoachAccess ? (
                <div className="mt-4 rounded-xl border border-border bg-background-alt/65 p-4 text-sm leading-5 text-foreground-soft">
                  {subscription.isPending ? (
                    "Checking Live Coach access…"
                  ) : subscription.isError ? (
                    "Live Coach access could not be verified. Refresh before starting a session."
                  ) : (
                    <>
                      Live Coach is included with Pro. Safety guidance remains
                      available on every plan. {" "}
                      <Link
                        href="/dashboard/settings"
                        className="font-medium text-primary underline underline-offset-4"
                      >
                        View plan
                      </Link>
                    </>
                  )}
                </div>
              ) : null}
            </div>

            <div className="space-y-4 border-t border-border p-5 sm:p-6">
              {devices.length > 1 ? (
                <div className="space-y-2">
                  <Label htmlFor="live-coach-camera">Camera</Label>
                  <select
                    id="live-coach-camera"
                    value={selectedDeviceId}
                    onChange={(event) => setSelectedDeviceId(event.target.value)}
                    disabled={isActive}
                    className="h-10 w-full rounded-xl border border-input bg-background px-3 text-sm disabled:opacity-55"
                  >
                    {devices.map((device) => (
                      <option key={device.deviceId} value={device.deviceId}>
                        {device.label}
                      </option>
                    ))}
                  </select>
                  <p className="text-xs leading-5 text-foreground-faint">
                    Stop the session before switching between front and rear cameras.
                  </p>
                </div>
              ) : null}

              {status === "running" || isActive ? (
                <Button
                  type="button"
                  variant="outline"
                  size="lg"
                  className="w-full gap-2"
                  onClick={stopSession}
                >
                  <Square className="size-4 fill-current" />
                  Stop session
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="brand"
                  size="lg"
                  className="w-full gap-2"
                  disabled={!safetyAcknowledged || !hasLiveCoachAccess}
                  onClick={startSession}
                >
                  {status === "stopped" || status === "error" ? (
                    <RefreshCw className="size-4" />
                  ) : (
                    <Camera className="size-4" />
                  )}
                  {status === "stopped" || status === "error"
                    ? "Restart Live Coach"
                    : "Start Live Coach"}
                </Button>
              )}
            </div>
          </aside>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-[minmax(0,1.25fr)_minmax(300px,0.75fr)]">
        <div className="rounded-[1.6rem] border border-border bg-card/65 p-5 sm:p-7">
          <div className="flex items-start gap-4">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary-light text-primary">
              <ShieldCheck className="size-5" />
            </span>
            <div>
              <p className="font-mono text-[0.56rem] font-semibold tracking-[0.14em] text-primary uppercase">
                Safety / readiness · available on every plan
              </p>
              <h2 className="mt-2 text-xl font-medium tracking-[-0.035em]">
                Set up before the camera starts.
              </h2>
              <p className="mt-2 text-sm leading-6 text-foreground-soft">
                Use a stable pull-up bar with clear space, secure your grip before
                leaving the ground, and begin from a controlled hang. Stop for
                sharp or increasing pain, loss of grip, numbness, dizziness, or
                unusual shortness of breath.
              </p>
              <p className="mt-3 text-xs leading-5 text-foreground-faint">
                Open Ascent provides fitness guidance, not medical assessment,
                diagnosis, clearance, rehabilitation, or treatment advice.
              </p>
            </div>
          </div>

          <div className="mt-5 flex items-start gap-3 rounded-2xl border border-border bg-background-alt/60 p-4">
            <Checkbox
              id="live-coach-safety"
              checked={safetyAcknowledged}
              onCheckedChange={(checked) => setSafetyAcknowledged(checked === true)}
              disabled={isActive}
            />
            <Label
              htmlFor="live-coach-safety"
              className="cursor-pointer text-sm leading-5 font-normal"
            >
              I have checked the bar and surrounding space, can hang comfortably,
              and will stop if grip or body control breaks down.
            </Label>
          </div>
        </div>

        <div className="rounded-[1.6rem] border border-border bg-background-alt/65 p-5 sm:p-7">
          <div className="flex items-center gap-3">
            <LockKeyhole className="size-5 text-primary" />
            <div>
              <p className="font-mono text-[0.56rem] font-semibold tracking-[0.14em] text-primary uppercase">
                Privacy boundary
              </p>
              <h2 className="mt-1 text-lg font-medium">Frames stay on this device.</h2>
            </div>
          </div>
          <p className="mt-3 text-sm leading-6 text-foreground-soft">
            The browser downloads static MediaPipe code and a pose model. Camera
            frames are passed directly from the video element to local inference;
            they are not recorded, encoded, uploaded, or persisted.
          </p>

          <div className="mt-5 grid grid-cols-2 gap-3 border-t border-border pt-5">
            <SmallMetric
              label="Inference"
              value={fps > 0 ? `${fps.toFixed(1)} fps` : "—"}
            />
            <SmallMetric
              label="Frame time"
              value={inferenceMs > 0 ? `${Math.round(inferenceMs)} ms` : "—"}
            />
            <SmallMetric
              label="Cue latency"
              value={estimatedCueLatency ? `~${estimatedCueLatency} ms` : "—"}
            />
            <SmallMetric
              label="Initialization"
              value={initializationMs ? `${Math.round(initializationMs)} ms` : "—"}
            />
          </div>
          <p className="mt-4 flex items-center gap-2 text-xs text-foreground-faint">
            <Gauge className="size-3.5" />
            {delegate ? `${delegate} delegate · 12 fps target` : "12 fps target · measured when running"}
          </p>
        </div>
      </section>
    </div>
  );
}

function Metric({
  label,
  value,
  capitalize = false,
}: {
  label: string;
  value: string;
  capitalize?: boolean;
}) {
  return (
    <div className="p-5 sm:p-6">
      <p className="font-mono text-[0.54rem] font-semibold tracking-[0.12em] text-foreground-faint uppercase">
        {label}
      </p>
      <p
        className={cn(
          "mt-2 text-2xl font-medium tracking-[-0.04em]",
          capitalize && "capitalize",
        )}
      >
        {value}
      </p>
    </div>
  );
}

function SmallMetric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="font-mono text-[0.52rem] tracking-[0.1em] text-foreground-faint uppercase">
        {label}
      </p>
      <p className="mt-1 text-sm font-medium">{value}</p>
    </div>
  );
}

function StatusPill({ ready, label }: { ready: boolean; label: string }) {
  return (
    <span className="flex items-center gap-2 rounded-full border border-white/10 bg-black/45 px-3 py-1.5 font-mono text-[0.58rem] tracking-[0.12em] text-white/80 uppercase backdrop-blur">
      <span
        className={cn(
          "size-1.5 rounded-full",
          ready ? "bg-primary" : "bg-white/35",
        )}
      />
      {label}
    </span>
  );
}

function drawPose(
  canvas: HTMLCanvasElement | null,
  video: HTMLVideoElement | null,
  landmarks: PoseLandmark[] | null,
) {
  if (!canvas || !video) return;
  const width = video.videoWidth || 1280;
  const height = video.videoHeight || 720;
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) return;
  context.clearRect(0, 0, width, height);
  if (!landmarks) return;

  context.lineWidth = Math.max(2, width / 420);
  context.strokeStyle = "#a7b28f";
  context.fillStyle = "#f5f0e8";

  for (const [startIndex, endIndex] of poseConnections) {
    const start = landmarks[startIndex];
    const end = landmarks[endIndex];
    if (!start || !end || (start.visibility ?? 1) < 0.5 || (end.visibility ?? 1) < 0.5) continue;
    context.beginPath();
    context.moveTo(start.x * width, start.y * height);
    context.lineTo(end.x * width, end.y * height);
    context.stroke();
  }

  for (const index of new Set(poseConnections.flat())) {
    const landmark = landmarks[index];
    if (!landmark || (landmark.visibility ?? 1) < 0.5) continue;
    context.beginPath();
    context.arc(
      landmark.x * width,
      landmark.y * height,
      Math.max(3, width / 300),
      0,
      Math.PI * 2,
    );
    context.fill();
  }
}

function clearCanvas(canvas: HTMLCanvasElement | null) {
  const context = canvas?.getContext("2d");
  if (canvas && context) context.clearRect(0, 0, canvas.width, canvas.height);
}

function normalizeSessionError(error: unknown) {
  return error instanceof LiveCoachSessionError
    ? error
    : new LiveCoachSessionError("camera", "The session could not start.", {
        cause: error,
      });
}

function sessionErrorMessage(error: LiveCoachSessionError) {
  const cause = error.cause;
  const name = cause instanceof DOMException ? cause.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return "Camera permission was denied. Allow camera access in browser settings, then restart the session.";
  }
  if (name === "NotFoundError" || name === "DevicesNotFoundError") {
    return "No camera is available. Connect or enable a camera, then restart the session.";
  }
  if (name === "NotReadableError" || name === "TrackStartError") {
    return "The camera is busy or could not be initialized. Close other camera apps and try again.";
  }
  if (error.stage === "mediapipe") {
    return "The local pose model could not initialize. Check the connection used to download the static model files and try again.";
  }
  if (error.stage === "inference") {
    return "Local pose inference stopped. The camera has been released; restart the session to try again.";
  }
  return "The camera could not start. Check browser permission and device availability, then try again.";
}
