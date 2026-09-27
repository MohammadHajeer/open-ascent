"use client";

import { useEffect, useRef, useState } from "react";

import { LiveCoachCameraSession, LiveCoachSessionError, type LiveFrame } from "../camera-session.ts";
import { createMediaPipePoseRuntime } from "../mediapipe-pose.ts";
import { LiveCoachAnalyzer } from "../live-analyzer.ts";
import { CAMERA_OFF_CUE, cameraOffCue, INITIAL_SNAPSHOT, type DeviceOption, type SessionStatus } from "../session-state.ts";
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
  const [mirrorPreview, setMirrorPreview] = useState(true);
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [fps, setFps] = useState(0);
  const [inferenceMs, setInferenceMs] = useState(0);
  const [initializationMs, setInitializationMs] = useState<number | null>(null);
  const [delegate, setDelegate] = useState<"GPU" | "CPU" | null>(null);

  const isActive =
    status === "verifying-access" ||
    status === "requesting-camera" ||
    status === "loading-pose" ||
    status === "running";
  const hasLiveCoachAccess = access.data?.allowed === true;
  useScreenWakeLock(status === "running");

  useEffect(() => () => {
    startGenerationRef.current += 1;
    sessionRef.current?.stop();
    voiceRef.current?.stop();
  }, []);

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
    lastLoggedRepRef.current = 0;
    clearCanvas(canvasRef.current);
    setSnapshot(INITIAL_SNAPSHOT);
    setCue({
      id: "camera-starting",
      priority: 0,
      tone: "neutral",
      title: "Starting camera and pose tracking",
      detail: analyzer.movement === "push-up"
        ? "Place the camera beside you with your full body in view."
        : "Stand where your wrists, shoulders, and hips can stay in view.",
    });
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
      if (generation !== startGenerationRef.current) {
        session.stop();
        return;
      }
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
    clearCanvas(canvasRef.current);
  }

  function handleFrame(frame: LiveFrame) {
    drawPose(canvasRef.current, videoRef.current, frame.landmarks);
    const video = videoRef.current;
    const { snapshot: nextSnapshot, cue: nextCue } = analyzer.update(
      frame.landmarks,
      frame.timestampMs,
      video?.videoWidth && video.videoHeight ? video.videoWidth / video.videoHeight : 1,
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
  }

  function handleSessionError(error: LiveCoachSessionError) {
    sessionRef.current?.stop();
    sessionRef.current = null;
    voiceRef.current?.stop();
    setStatus("error");
    setCue(cameraOffCue(analyzer.movement));
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
    mirrorPreview,
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
