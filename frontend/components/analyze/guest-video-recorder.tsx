"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, CircleStop, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  cameraErrorMessage,
  formatRecordingTime,
  guestCameraConstraints,
  RECORDING_BIT_RATE,
  recordingFileExtension,
  selectRecordingMimeType,
  startRecordingDeadline,
  stopMediaStream,
} from "./guest-video-recorder-support";

type RecordedClip = {
  file: File;
  durationSeconds: number;
};

export function GuestVideoRecorder({
  maxDurationSeconds,
  maxSizeBytes,
  onUse,
  onCancel,
  acknowledged,
  onAcknowledgedChange,
}: {
  maxDurationSeconds: number;
  maxSizeBytes: number;
  onUse: (clip: RecordedClip) => void;
  onCancel: () => void;
  acknowledged: boolean;
  onAcknowledgedChange: (acknowledged: boolean) => void;
}) {
  const liveVideoRef = useRef<HTMLVideoElement>(null);
  const mountedRef = useRef(true);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const deadlineCleanupRef = useRef<(() => void) | null>(null);
  const startedAtRef = useRef(0);
  const objectUrlRef = useRef<string | null>(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [recording, setRecording] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState("");
  const [mirrored, setMirrored] = useState(true);
  const [clip, setClip] = useState<RecordedClip | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const clearTimers = useCallback(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    deadlineCleanupRef.current?.();
    deadlineCleanupRef.current = null;
    intervalRef.current = null;
    timeoutRef.current = null;
  }, []);

  const stopTracks = useCallback(() => {
    stopMediaStream(streamRef.current);
    streamRef.current = null;
    if (liveVideoRef.current) liveVideoRef.current.srcObject = null;
    if (mountedRef.current) setCameraActive(false);
  }, []);

  const discardClip = useCallback(() => {
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    objectUrlRef.current = null;
    setPreviewUrl(null);
    setClip(null);
  }, []);

  const stopRecording = useCallback(() => {
    clearTimers();
    const recorder = recorderRef.current;
    if (recorder?.state === "recording") recorder.stop();
    setRecording(false);
    stopTracks();
  }, [clearTimers, stopTracks]);

  const startCamera = useCallback(async (nextDeviceId?: string) => {
    setError(null);
    clearTimers();
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
    stopTracks();

    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setError("Video recording is not supported by this browser. Upload an MP4 video instead.");
      return;
    }
    if (!selectRecordingMimeType(MediaRecorder.isTypeSupported.bind(MediaRecorder))) {
      setError("This browser cannot record a compatible video format. Upload an MP4 video instead.");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia(
        guestCameraConstraints(nextDeviceId),
      );
      if (!mountedRef.current) {
        stopMediaStream(stream);
        return;
      }
      streamRef.current = stream;
      if (liveVideoRef.current) {
        liveVideoRef.current.srcObject = stream;
        await liveVideoRef.current.play();
      }
      setCameraActive(true);
      const available = (await navigator.mediaDevices.enumerateDevices())
        .filter((device) => device.kind === "videoinput");
      setDevices(available);
      const selected = nextDeviceId
        ? available.find((device) => device.deviceId === nextDeviceId)
        : available.find((device) => device.deviceId === stream.getVideoTracks()[0]?.getSettings().deviceId);
      setDeviceId(selected?.deviceId ?? nextDeviceId ?? "");
      setMirrored(!selected?.label || /front|user|face|facetime/i.test(selected.label));
    } catch (cause) {
      stopTracks();
      if (mountedRef.current) setError(cameraErrorMessage(cause));
    }
  }, [clearTimers, stopTracks]);

  const startRecording = useCallback(() => {
    const stream = streamRef.current;
    const mimeType = typeof MediaRecorder === "undefined"
      ? null
      : selectRecordingMimeType(MediaRecorder.isTypeSupported.bind(MediaRecorder));
    if (!stream || !mimeType) {
      setError("The camera is not ready to record a compatible video.");
      return;
    }

    discardClip();
    setError(null);
    chunksRef.current = [];
    setElapsedMs(0);
    startedAtRef.current = performance.now();
    try {
      const recorder = new MediaRecorder(stream, {
        mimeType,
        videoBitsPerSecond: RECORDING_BIT_RATE,
      });
      recorderRef.current = recorder;
      recorder.ondataavailable = (event) => {
        if (event.data.size) chunksRef.current.push(event.data);
      };
      recorder.onerror = () => {
        setError("Recording failed. Please try again or upload a video.");
        stopRecording();
      };
      recorder.onstop = () => {
        const durationSeconds = Math.min(
          maxDurationSeconds,
          Math.max(0.1, (performance.now() - startedAtRef.current) / 1000),
        );
        const blob = new Blob(chunksRef.current, { type: mimeType });
        recorderRef.current = null;
        if (!mountedRef.current) return;
        if (!blob.size) {
          setError("No video was captured. Please record again.");
          return;
        }
        if (blob.size > maxSizeBytes) {
          setError("This recording is larger than the 10 MB guest limit. Please record again.");
          return;
        }
        const extension = recordingFileExtension(mimeType);
        const file = new File([blob], `open-ascent-recording.${extension}`, { type: mimeType });
        const url = URL.createObjectURL(file);
        objectUrlRef.current = url;
        setPreviewUrl(url);
        setClip({ file, durationSeconds });
      };
      recorder.start(250);
      setRecording(true);
      deadlineCleanupRef.current = startRecordingDeadline({
        maxDurationMs: maxDurationSeconds * 1000,
        startedAt: startedAtRef.current,
        now: () => performance.now(),
        onTick: setElapsedMs,
        onDeadline: stopRecording,
      });
    } catch {
      setError("Recording could not start. Please try again or upload a video.");
      stopRecording();
    }
  }, [discardClip, maxDurationSeconds, maxSizeBytes, stopRecording]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      clearTimers();
      if (recorderRef.current?.state === "recording") recorderRef.current.stop();
      stopTracks();
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    };
  }, [clearTimers, stopTracks]);

  async function retake() {
    discardClip();
    setElapsedMs(0);
    await startCamera(deviceId || undefined);
  }

  return (
    <div className="mt-8 overflow-hidden rounded-[3px_3px_34px_3px] border border-border bg-card">
      <div className="relative min-h-90 bg-visual-surface sm:min-h-120">
        {clip && previewUrl ? (
          <video className="absolute inset-0 size-full object-contain" src={previewUrl} controls playsInline />
        ) : (
          <video
            ref={liveVideoRef}
            className={`absolute inset-0 size-full object-contain ${mirrored ? "-scale-x-100" : ""}`}
            muted
            playsInline
          />
        )}
        {recording && (
          <span className="absolute top-4 left-4 inline-flex items-center gap-2 rounded-full bg-destructive px-3 py-2 font-mono text-[0.62rem] text-white uppercase">
            <span className="size-2 animate-pulse rounded-full bg-white" /> REC
          </span>
        )}
        {(recording || clip) && (
          <span className="absolute top-4 right-4 rounded-full bg-visual-surface/85 px-3 py-2 font-mono text-[0.62rem] text-visual-foreground">
            {formatRecordingTime(clip ? clip.durationSeconds * 1000 : elapsedMs)} / {formatRecordingTime(maxDurationSeconds * 1000)}
          </span>
        )}
        {!cameraActive && !clip && (
          <div className="absolute inset-0 grid place-items-center px-6 text-center">
            <div className="max-w-md">
              <span className="mx-auto grid size-14 place-items-center rounded-full border border-border bg-background text-primary"><Camera className="size-5" /></span>
              <h3 className="mt-6 text-2xl font-medium">Record in your browser</h3>
              <p className="mt-3 text-sm leading-6 text-visual-foreground/75">Your clip stays on this device until you choose Use video. Camera only—no microphone.</p>
              <Button variant="brand" size="lg" className="mt-7" onClick={() => void startCamera()}>Allow camera</Button>
            </div>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-4 border-t border-border p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
        <div className="min-w-0">
          {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
          {clip ? (
            <div>
              <p className="text-sm text-foreground-soft">{clip.durationSeconds.toFixed(1)} seconds · {(clip.file.size / 1048576).toFixed(1)} MB</p>
              <label className="mt-3 flex max-w-xl cursor-pointer items-start gap-3 text-sm leading-6 text-foreground">
                <Checkbox className="mt-1" checked={acknowledged} onCheckedChange={(checked) => onAcknowledgedChange(checked === true)} />
                I have read the safety guidance below and understand this analysis is informational.
              </label>
            </div>
          ) : cameraActive ? (
            <div className="flex flex-wrap items-center gap-3">
              <p className="text-sm text-foreground-soft">Keep your full movement and equipment visible.</p>
              {devices.length > 1 && !recording && (
                <Select
                  items={devices.map((device, index) => ({ value: device.deviceId, label: device.label || `Camera ${index + 1}` }))}
                  value={deviceId}
                  onValueChange={(value) => { if (value) void startCamera(value); }}
                >
                  <SelectTrigger aria-label="Camera" className="h-9 w-56 max-w-full rounded-lg bg-background">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {devices.map((device, index) => <SelectItem key={device.deviceId} value={device.deviceId}>{device.label || `Camera ${index + 1}`}</SelectItem>)}
                  </SelectContent>
                </Select>
              )}
            </div>
          ) : <p className="text-sm text-foreground-soft">Maximum {maxDurationSeconds} seconds · 10 MB</p>}
        </div>
        <div className="flex shrink-0 flex-wrap gap-3">
          {clip ? (
            <>
              <Button variant="outline" onClick={() => void retake()}><RefreshCw className="size-4" /> Retake</Button>
              <Button variant="brand" disabled={!acknowledged} onClick={() => onUse(clip)}>Use video</Button>
            </>
          ) : recording ? (
            <Button variant="destructive" onClick={stopRecording}><CircleStop className="size-4" /> Stop recording</Button>
          ) : cameraActive ? (
            <>
              <Button variant="ghost" onClick={onCancel}>Back to upload</Button>
              <Button variant="brand" onClick={startRecording}><span className="size-2 rounded-full bg-current" /> Start recording</Button>
            </>
          ) : (
            <Button variant="ghost" onClick={onCancel}>Back to upload</Button>
          )}
        </div>
      </div>
    </div>
  );
}
