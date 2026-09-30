"use client";

import { useEffect, useRef, useState } from "react";

import { LiveCoachCameraSession, LiveCoachSessionError, type CameraFacing, type LiveFrame } from "../camera-session.ts";
import { checkCameraSignal, createCanvasSignalProbe, isBlankFrame, type CameraSignal } from "../camera-signal.ts";
import { createMediaPipePoseRuntime } from "../mediapipe-pose.ts";
import { LiveCoachAnalyzer } from "../live-analyzer.ts";
import { TrackingRateMonitor } from "../tracking-rate.ts";
import {
  CAMERA_OFF_CUE,
  cameraOffCue,
  cameraOptions,
  INITIAL_SNAPSHOT,
  type CameraInfo,
  type DeviceOption,
  type SessionStatus,
} from "../session-state.ts";
import { drawPose, clearCanvas } from "../utils/pose-canvas.ts";
import { normalizeSessionError, sessionErrorMessage } from "../utils/session-errors.ts";
import { LiveCoachVoice } from "../voice.ts";
import { createWebAudioVoiceOutput } from "../voice-output.ts";
import type { LiveCoachCue, LiveCoachMovement, LiveCoachSnapshot } from "../types.ts";
import { useScreenWakeLock } from "./use-screen-wake-lock.ts";
import { fetchLiveCoachAccess } from "@/features/subscription/api";
import { useLiveCoachAccess } from "@/features/subscription/hooks";

export function useLiveCoachSession() {
  const access = useLiveCoachAccess();
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sessionRef = useRef<LiveCoachCameraSession | null>(null);
  const [analyzer] = useState(() => new LiveCoachAnalyzer());
  const [movement, setMovement] = useState<LiveCoachMovement>("vertical-pull");
  const lastLoggedRepRef = useRef(0);
  const voiceRef = useRef<LiveCoachVoice | null>(null);
  const startGenerationRef = useRef(0);

  const [status, setStatus] = useState<SessionStatus>("idle");
  const [safetyAcknowledged, setSafetyAcknowledged] = useState(false);
  const [snapshot, setSnapshot] = useState<LiveCoachSnapshot>(INITIAL_SNAPSHOT);
  const [cue, setCue] = useState<LiveCoachCue>(CAMERA_OFF_CUE);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [devices, setDevices] = useState<DeviceOption[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState("");
  // Used when no specific camera is chosen; phones open this side's camera.
  const [cameraFacing, setCameraFacing] = useState<CameraFacing>("user");
  const [mirrorPreview, setMirrorPreview] = useState(true);
  const [trackingRate] = useState(() => new TrackingRateMonitor());
  const [lowTrackingRate, setLowTrackingRate] = useState(false);
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [fps, setFps] = useState(0);
  const [inferenceMs, setInferenceMs] = useState(0);
  const [initializationMs, setInitializationMs] = useState<number | null>(null);
  const [delegate, setDelegate] = useState<"GPU" | "CPU" | null>(null);
  // "image" once real frames show a picture; "blank" when the camera delivers
  // a flat fill (e.g. an idle virtual camera's solid green).
  const [cameraSignal, setCameraSignal] = useState<Exclude<CameraSignal, "no-frames"> | null>(null);
  const [cameraInfo, setCameraInfo] = useState<CameraInfo | null>(null);
  const [probe] = useState(createCanvasSignalProbe);

  const isActive =
    status === "verifying-access" ||
    status === "requesting-camera" ||
    status === "checking-camera" ||
    status === "loading-pose" ||
    status === "running";
  const hasLiveCoachAccess = access.data?.allowed === true;
  useScreenWakeLock(status === "running");

  useEffect(() => () => {
    startGenerationRef.current += 1;
    sessionRef.current?.stop();
    voiceRef.current?.stop();
  }, []);

  // List cameras before the first start when permission already exists, and
  // follow plug/unplug (a USB phone camera appearing or disappearing).
  useEffect(() => {
    const media = navigator.mediaDevices;
    if (!media?.enumerateDevices) return;
    let cancelled = false;
    const refresh = () => {
      void media.enumerateDevices().then((available) => {
        if (cancelled) return;
        const options = cameraOptions(available);
        setDevices(options);
        setSelectedDeviceId((current) =>
          !current || options.some((device) => device.deviceId === current) ? current : "",
        );
      }, () => {});
    };
    refresh();
    media.addEventListener?.("devicechange", refresh);
    return () => {
      cancelled = true;
      media.removeEventListener?.("devicechange", refresh);
    };
  }, []);

  // Keep checking the live picture: a phone camera can drop to a flat frame
  // mid-set, or start delivering an image after its app connects.
  useEffect(() => {
    if (status !== "running") return;
    let blankSamples = 0;
    const timer = window.setInterval(() => {
      const video = videoRef.current;
      const stats = video ? probe.sample(video) : null;
      if (!stats) return;
      if (!isBlankFrame(stats)) {
        blankSamples = 0;
        setCameraSignal("image");
      } else if (++blankSamples >= 2) {
        setCameraSignal("blank");
      }
    }, 1500);
    return () => window.clearInterval(timer);
  }, [status, probe]);

  async function startSession() {
    if (!videoRef.current || !safetyAcknowledged || !hasLiveCoachAccess || isActive) return;
    const generation = ++startGenerationRef.current;
    // Audio must be created inside the Start click: mobile browsers only
    // unlock playback from a user gesture, and the access check below awaits.
    sessionRef.current?.stop();
    voiceRef.current?.stop();
    const voice = new LiveCoachVoice(createWebAudioVoiceOutput());
    voice.setEnabled(voiceEnabled);
    voice.preload();
    voiceRef.current = voice;
    // Bring the camera and count into view; the Start button sits below them.
    videoRef.current.closest("section")?.scrollIntoView({ behavior: "smooth", block: "start" });
    const releaseVoice = () => {
      voice.stop();
      if (voiceRef.current === voice) voiceRef.current = null;
    };

    setStatus("verifying-access");
    setErrorMessage(null);
    try {
      const freshAccess = await fetchLiveCoachAccess();
      if (generation !== startGenerationRef.current) return;
      if (!freshAccess.allowed) {
        releaseVoice();
        setStatus("idle");
        setErrorMessage("Live Coach is included with Pro. Check your plan, then try again.");
        void access.refetch();
        return;
      }
    } catch {
      if (generation !== startGenerationRef.current) return;
      releaseVoice();
      setStatus("error");
      setErrorMessage("We couldn't confirm your Live Coach access. Check your connection and try again.");
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      releaseVoice();
      setStatus("error");
      setErrorMessage(
        "This browser can't open the camera. Use a current browser on a secure (HTTPS) page.",
      );
      return;
    }

    voice.start();
    analyzer.reset();
    trackingRate.reset();
    setLowTrackingRate(false);
    lastLoggedRepRef.current = 0;
    clearCanvas(canvasRef.current);
    setSnapshot(INITIAL_SNAPSHOT);
    setCue({
      id: "camera-starting",
      priority: 0,
      tone: "neutral",
      title: "Starting camera and pose tracking",
      detail: analyzer.movement === "dips"
        ? "Place the camera beside the parallel bars with your shoulder, elbow, wrist, and hip in view."
        : analyzer.movement === "push-up"
        ? "Place the camera beside you with your full body in view."
        : analyzer.movement === "muscle-up"
          ? "Place the camera beside the bar so you stay in view above and below it."
          : "Stand where your wrists, shoulders, and hips can stay in view.",
    });
    setFps(0);
    setInferenceMs(0);
    setDelegate(null);
    setErrorMessage(null);
    setCameraSignal(null);
    setCameraInfo(null);
    setStatus("requesting-camera");

    const session = new LiveCoachCameraSession({
      getUserMedia: (constraints) =>
        navigator.mediaDevices.getUserMedia(constraints),
      createPoseRuntime: createMediaPipePoseRuntime,
      requestFrame: (callback) => requestAnimationFrame(callback),
      cancelFrame: (handle) => cancelAnimationFrame(handle),
      now: () => performance.now(),
      checkSignal: (video) => checkCameraSignal(video as HTMLVideoElement, probe),
      ...("requestVideoFrameCallback" in HTMLVideoElement.prototype ? {
        requestVideoFrame: (video, callback) => (video as HTMLVideoElement).requestVideoFrameCallback(
          (nowMs, metadata) => callback(nowMs, { presentedFrames: metadata.presentedFrames, captureTime: metadata.captureTime }),
        ),
        cancelVideoFrame: (video, handle) => (video as HTMLVideoElement).cancelVideoFrameCallback(handle),
      } : {}),
    });
    sessionRef.current = session;

    try {
      const result = await session.start(
        videoRef.current,
        {
          onCameraConnected: () => setStatus("checking-camera"),
          onCameraReady: (signal) => {
            setCameraSignal(signal === "image" ? "image" : "blank");
            setStatus("loading-pose");
          },
          onFrame: handleFrame,
          onError: handleSessionError,
        },
        selectedDeviceId || undefined,
        cameraFacing,
      );
      if (!result) return;
      if (generation !== startGenerationRef.current) {
        session.stop();
        return;
      }
      // One line per start so camera problems can be diagnosed from the console.
      console.info("[Live Coach camera]", {
        label: result.deviceLabel,
        signal: result.signal,
        settings: `${result.width ?? "?"}x${result.height ?? "?"} @ ${result.frameRate ?? "?"} fps`,
        attempts: result.attempts.map((attempt) =>
          `${attempt.tier}: ${attempt.signal}` +
          (attempt.width ? ` ${attempt.width}x${attempt.height}` : "") +
          (attempt.mean ? ` avg rgb(${attempt.mean.map(Math.round).join(",")})` : ""),
        ).join(" → "),
      });
      setCameraInfo({
        label: result.deviceLabel,
        width: result.width,
        height: result.height,
        frameRate: result.frameRate,
        tier: result.tier,
      });
      setStatus("running");
      setDelegate(result.delegate);
      const rearFacingLabel = /\b(back|rear|environment)\b/i.test(
        result.deviceLabel,
      );
      setMirrorPreview(
        result.facingMode !== "environment" && !rearFacingLabel,
      );
      // Reflect the camera actually opened (a chosen device may face either way).
      if (result.facingMode === "environment" || rearFacingLabel) setCameraFacing("environment");
      else if (result.facingMode === "user") setCameraFacing("user");
      setInitializationMs(result.initializationMs);
      await refreshCameraList(result.deviceId);
    } catch (error) {
      if (generation !== startGenerationRef.current) return;
      const sessionError = normalizeSessionError(error);
      // A remembered camera that was unplugged fails its exact-device request.
      if (selectedDeviceId && sessionError.cause instanceof DOMException &&
        (sessionError.cause.name === "OverconstrainedError" || sessionError.cause.name === "NotFoundError")) {
        setSelectedDeviceId("");
      }
      handleSessionError(sessionError);
    }
  }

  function stopSession() {
    startGenerationRef.current += 1;
    sessionRef.current?.stop();
    sessionRef.current = null;
    if (status === "running") voiceRef.current?.finish(snapshot);
    else voiceRef.current?.stop();
    setStatus("stopped");
    setCue(cameraOffCue(analyzer.movement));
    setDelegate(null);
    setCameraSignal(null);
    setLowTrackingRate(false);
    clearCanvas(canvasRef.current);
  }

  function handleFrame(frame: LiveFrame) {
    drawPose(canvasRef.current, videoRef.current, frame.landmarks);
    const video = videoRef.current;
    // Read per frame: rotating a phone swaps the stream's width and height.
    const { snapshot: nextSnapshot, cue: nextCue } = analyzer.update(
      frame.landmarks,
      frame.timestampMs,
      video?.videoWidth && video.videoHeight ? video.videoWidth / video.videoHeight : undefined,
    );
    if (analyzer.movement === "vertical-pull" && process.env.NODE_ENV === "development" &&
      nextSnapshot.latestRep?.outcome === "valid" &&
      nextSnapshot.latestRep.index !== lastLoggedRepRef.current) {
      lastLoggedRepRef.current = nextSnapshot.latestRep.index;
      console.debug("[Live Coach variant]", {
        rep: nextSnapshot.latestRep.index,
        gripSource: "Pose only",
        ...analyzer.getClassificationDiagnostics(),
      });
    }
    setSnapshot(nextSnapshot);
    setCue(nextCue);
    voiceRef.current?.onFrame(nextSnapshot, nextCue, frame.timestampMs);
    setFps(frame.inferenceFps);
    setInferenceMs(frame.inferenceMs);
    setLowTrackingRate(trackingRate.update(frame.inferenceFps, frame.timestampMs));
  }

  function handleSessionError(error: LiveCoachSessionError) {
    sessionRef.current?.stop();
    sessionRef.current = null;
    voiceRef.current?.stop();
    setStatus("error");
    setCue(cameraOffCue(analyzer.movement));
    setDelegate(null);
    setCameraSignal(null);
    setLowTrackingRate(false);
    setErrorMessage(sessionErrorMessage(error));
    clearCanvas(canvasRef.current);
  }

  async function refreshCameraList(activeDeviceId: string | null) {
    try {
      const available = await navigator.mediaDevices.enumerateDevices();
      setDevices(cameraOptions(available));
      if (activeDeviceId) setSelectedDeviceId(activeDeviceId);
    } catch {
      // Camera enumeration is optional; the active stream can continue.
    }
  }

  /** Front or rear, for the next Start; replaces any specific camera choice. */
  function selectCameraFacing(facing: CameraFacing) {
    if (isActive) return;
    setCameraFacing(facing);
    setSelectedDeviceId("");
  }

  function toggleVoice() {
    const enabled = !voiceEnabled;
    setVoiceEnabled(enabled);
    voiceRef.current?.setEnabled(enabled);
  }

  function selectMovement(nextMovement: LiveCoachMovement) {
    if (nextMovement === analyzer.movement) return;
    // Switching must also release queued audio and reset voice count/cooldowns.
    voiceRef.current?.stop();
    stopSession();
    voiceRef.current = null;
    setSnapshot(analyzer.selectMovement(nextMovement));
    setMovement(nextMovement);
    lastLoggedRepRef.current = 0;
    setSafetyAcknowledged(false);
    setErrorMessage(null);
    setCue(cameraOffCue(nextMovement));
    setFps(0);
    setInferenceMs(0);
    setInitializationMs(null);
  }

  return {
    videoRef,
    canvasRef,
    access,
    status,
    isActive,
    hasLiveCoachAccess,
    safetyAcknowledged,
    setSafetyAcknowledged,
    snapshot,
    movement,
    selectMovement,
    cue,
    errorMessage,
    devices,
    selectedDeviceId,
    setSelectedDeviceId,
    cameraFacing,
    selectCameraFacing,
    lowTrackingRate,
    mirrorPreview,
    cameraSignal,
    cameraInfo,
    voiceEnabled,
    toggleVoice,
    fps,
    inferenceMs,
    initializationMs,
    delegate,
    startSession,
    stopSession,
  };
}
