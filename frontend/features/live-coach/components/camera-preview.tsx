import { Camera, CameraOff, RefreshCw, Square } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { useLiveCoachSession } from "../hooks/use-live-coach-session.ts";

type Props = { session: ReturnType<typeof useLiveCoachSession> };

export function CameraPreview({ session }: Props) {
  const { videoRef, canvasRef, mirrorPreview, isActive, status, snapshot, cue, stopSession } = session;
  return (
    <div className="relative h-[min(58dvh,34rem)] min-h-72 overflow-hidden bg-visual-surface lg:h-auto lg:min-h-144">
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

      {status === "verifying-access" || status === "requesting-camera" || status === "loading-pose" ? (
        <div className="absolute inset-x-5 bottom-5 flex items-center gap-3 rounded-2xl border border-white/10 bg-black/55 px-4 py-3 text-sm text-white backdrop-blur">
          <RefreshCw className="size-4 animate-spin text-primary" />
          {status === "verifying-access"
            ? "Checking Pro access…"
            : status === "requesting-camera"
              ? "Waiting for camera permission…"
              : "Camera ready. Loading local pose model…"}
        </div>
      ) : null}

      <div className="absolute top-4 left-4 flex flex-wrap gap-2">
        <StatusPill
          ready={status === "loading-pose" || status === "running"}
          label={status === "loading-pose" || status === "running" ? "Camera ready" : "Camera off"}
        />
        {status === "running" ? (
          <StatusPill
            ready={snapshot.poseReady}
            label={!snapshot.personDetected
              ? "Find athlete"
              : !snapshot.poseReady
                ? "Improve tracking"
                : !snapshot.setupReady
                  ? "Set up hang"
                  : !snapshot.startingPositionReady
                    ? "Hold start"
                    : snapshot.phase === "bottom"
                      ? "Ready"
                      : "Active set"}
          />
        ) : null}
        <span className="rounded-full border border-white/10 bg-black/45 px-3 py-1.5 font-mono text-[0.58rem] tracking-[0.12em] text-white/70 uppercase backdrop-blur">
          Local inference
        </span>
      </div>
      {status === "running" ? (
        <div className="absolute inset-x-3 bottom-3 flex items-end justify-between gap-3 rounded-xl bg-black/70 p-3 text-white backdrop-blur lg:hidden">
          <div className="min-w-0">
            <p className="text-2xl font-semibold leading-none">{snapshot.validRepCount} <span className="text-xs font-normal">reps</span></p>
            <p className="mt-1 truncate text-xs">{cue.title}</p>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={stopSession} className="shrink-0 border-white/30 bg-black/45 text-white">
            <Square className="size-3 fill-current" /> Stop
          </Button>
        </div>
      ) : null}
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
