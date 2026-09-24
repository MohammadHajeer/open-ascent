"use client";

import { useEffect, useRef, useState } from "react";

import { LiveCoachCameraSession, LiveCoachSessionError, type LiveFrame } from "../camera-session.ts";
import { selectPrioritizedCue } from "../cues.ts";
import { createMediaPipePoseRuntime } from "../mediapipe-pose.ts";
import { LiveVerticalPullAnalyzer } from "../vertical-pull-analyzer.ts";
import { measurePullUpPose } from "../pull-up-semantics.ts";
import { CAMERA_OFF_CUE, INITIAL_SNAPSHOT, type DeviceOption, type SessionStatus } from "../session-state.ts";
import { drawPose, clearCanvas } from "../utils/pose-canvas.ts";
import { normalizeSessionError, sessionErrorMessage } from "../utils/session-errors.ts";
import { LiveCoachVoice } from "../voice.ts";
import type { LiveCoachCue } from "../types.ts";
import { fetchLiveCoachAccess } from "@/features/subscription/api";
import { useLiveCoachAccess } from "@/features/subscription/hooks";

export function useLiveCoachSession() {
  const access = useLiveCoachAccess();
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sessionRef = useRef<LiveCoachCameraSession | null>(null);
  const analyzerRef = useRef(new LiveVerticalPullAnalyzer());
  const lastLoggedRepRef = useRef(0);
  const voiceRef = useRef<LiveCoachVoice | null>(null);
  const startGenerationRef = useRef(0);

  const [status, setStatus] = useState<SessionStatus>("idle");
  const [safetyAcknowledged, setSafetyAcknowledged] = useState(false);
  const [snapshot, setSnapshot] = useState(INITIAL_SNAPSHOT);
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

  useEffect(() => () => {
    startGenerationRef.current += 1;
    sessionRef.current?.stop();
    voiceRef.current?.stop();
  }, []);

  async function startSession() {
    if (!videoRef.current || !safetyAcknowledged || !hasLiveCoachAccess || isActive) return;
    const generation = ++startGenerationRef.current;
    setStatus("verifying-access");
    setErrorMessage(null);
    try {
      const freshAccess = await fetchLiveCoachAccess();
      if (generation !== startGenerationRef.current) return;
      if (!freshAccess.allowed) {
        setStatus("idle");
        setErrorMessage("Live Coach requires an active Pro entitlement. Check your plan and try again.");
        void access.refetch();
        return;
      }
    } catch {
      if (generation !== startGenerationRef.current) return;
      setStatus("error");
      setErrorMessage("Live Coach access could not be verified. Try again when your connection is available.");
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus("error");
      setErrorMessage(
        "This browser does not expose camera access. Use a current Chromium browser over HTTPS or localhost.",
      );
      return;
    }

    sessionRef.current?.stop();
    voiceRef.current?.stop();
    const voice = new LiveCoachVoice((path) => new Audio(path));
    voice.setEnabled(voiceEnabled);
    voice.preload();
    voice.start();
    voiceRef.current = voice;
    analyzerRef.current.reset();
    lastLoggedRepRef.current = 0;
    clearCanvas(canvasRef.current);
    setSnapshot(INITIAL_SNAPSHOT);
    setCue({
      id: "camera-starting",
      priority: 0,
      tone: "neutral",
      title: "Starting camera and pose tracking",
      detail: "Stand where your wrists, shoulders, and hips can stay in view.",
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
      handleSessionError(normalizeSessionError(error));
    }
  }

  function stopSession() {
    startGenerationRef.current += 1;
    sessionRef.current?.stop();
    sessionRef.current = null;
    if (status === "running" && snapshot.validRepCount > 0) voiceRef.current?.finish();
    else voiceRef.current?.stop();
    setStatus("stopped");
    setCue(CAMERA_OFF_CUE);
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
      frame.landmarks !== null,
    );
    const nextCue = selectPrioritizedCue(nextSnapshot, frame.timestampMs);
    if (process.env.NODE_ENV === "development" &&
      nextSnapshot.latestRep?.outcome === "valid" &&
      nextSnapshot.latestRep.index !== lastLoggedRepRef.current) {
      lastLoggedRepRef.current = nextSnapshot.latestRep.index;
      console.debug("[Live Coach variant]", {
        rep: nextSnapshot.latestRep.index,
        gripSource: "Pose only",
        ...analyzerRef.current.getClassificationDiagnostics(),
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
    setCue(CAMERA_OFF_CUE);
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
