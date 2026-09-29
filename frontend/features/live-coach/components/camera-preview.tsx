import { Camera, CameraOff, Maximize2, RefreshCw, Square } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { FocusMode } from "../hooks/use-focus-mode.ts";
import type { useLiveCoachSession } from "../hooks/use-live-coach-session.ts";
import { FocusHud } from "./focus-hud";

type Props = { session: ReturnType<typeof useLiveCoachSession>; focus: FocusMode };

export function CameraPreview({ session, focus }: Props) {
  const { videoRef, canvasRef, mirrorPreview, isActive, status, snapshot, cue, stopSession, movement } = session;
  const isPushUp = movement === "push-up";
  const isDip = movement === "dips";
  const setComplete = status === "stopped" && snapshot.validRepCount > 0;
  const { active: inFocus, controlsVisible, rootRef, enter, exit } = focus;
  const inlineSize = "h-[min(58dvh,34rem)] min-h-72 lg:h-[min(calc(100dvh-8rem),46rem)] lg:min-h-120";
  return (
    <>
    {/* Holds the camera's grid cell so the page behind Focus Mode doesn't reflow or jump on exit. */}
    {inFocus ? <div className={inlineSize} aria-hidden="true" /> : null}
    {/* Focus Mode restyles this same element rather than portaling it, so the
        <video> keeps its stream and the session carries on uninterrupted. */}
    <div
      ref={rootRef}
      role={inFocus ? "dialog" : undefined}
      aria-modal={inFocus ? true : undefined}
      aria-label={inFocus ? "Live Coach focus mode" : undefined}
      className={cn(
        "overflow-hidden bg-visual-surface",
        inFocus
          ? cn("fixed inset-0 z-[60]", !controlsVisible && "cursor-none")
          : cn("relative lg:sticky lg:top-24 lg:self-start", inlineSize),
      )}
    >
      {inFocus ? null : <div className="cv-grid pointer-events-none absolute inset-0 opacity-15" />}
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
              {setComplete
                ? `Set complete · ${snapshot.validRepCount} ${snapshot.validRepCount === 1 ? "rep" : "reps"}`
                : status === "stopped"
                  ? "Camera is off."
                  : "Camera is off until you start."}
            </h2>
            <p className="mt-2 text-sm leading-6 text-white/55">
              {setComplete
                ? `${snapshot.partialRepCount > 0
                  ? `${snapshot.partialRepCount} partial ${snapshot.partialRepCount === 1 ? "attempt" : "attempts"} not counted. `
                  : ""}Restarting begins a new count.`
                : isDip
                  ? "Place the camera beside the parallel bars with shoulder, elbow, wrist, and hip visible through the full dip."
                  : isPushUp
                    ? "Place the camera beside you with your shoulder, elbow, wrist, hip, and ankle visible through the full rep."
                    : movement === "muscle-up"
                      ? "Place the camera beside the bar with your shoulder, elbow, and wrist visible from the hang to support above the bar."
                      : "Place the camera in front of the bar with your wrists, shoulders, and hips visible through the full rep."}
            </p>
          </div>
        </div>
      ) : null}

      {status === "verifying-access" || status === "requesting-camera" || status === "loading-pose" ? (
        <div className={cn(
          "absolute inset-x-5 bottom-5 flex items-center gap-3 rounded-2xl border border-white/10 bg-black/55 px-4 py-3 text-sm text-white backdrop-blur",
          inFocus && "bottom-22 sm:inset-x-auto sm:bottom-10 sm:left-1/2 sm:-translate-x-1/2 lg:bottom-14",
        )}>
          <RefreshCw className="size-4 animate-spin text-primary" />
          {status === "verifying-access"
            ? "Checking Pro access…"
            : status === "requesting-camera"
              ? "Waiting for camera permission…"
              : "Camera ready. Loading local pose model…"}
        </div>
      ) : null}

      <div className={cn("absolute inset-x-4 top-4 flex items-start justify-between gap-2", inFocus && "hidden")}>
        <div className="flex flex-wrap gap-2">
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
                    ? isDip ? "Set up support" : isPushUp ? "Set up plank" : "Set up hang"
                    : !snapshot.startingPositionReady
                      ? "Hold start"
                      : snapshot.phase === (isPushUp || isDip ? "top" : "bottom")
                        ? "Ready"
                        : "Active set"}
            />
          ) : null}
          <span className="rounded-full border border-white/10 bg-black/45 px-3 py-1.5 font-mono text-[0.58rem] tracking-[0.12em] text-white/70 uppercase backdrop-blur">
            On-device tracking
          </span>
        </div>
        {isActive || setComplete ? (
          <button
            type="button"
            onClick={enter}
            className="flex shrink-0 items-center gap-2 rounded-full border border-white/15 bg-black/45 px-3 py-1.5 font-mono text-[0.58rem] tracking-[0.12em] text-white/85 uppercase backdrop-blur transition-colors outline-none hover:bg-black/70 hover:text-white focus-visible:ring-2 focus-visible:ring-white/60"
          >
            <Maximize2 className="size-3" aria-hidden="true" />
            Focus mode
          </button>
        ) : null}
      </div>
      {inFocus ? <FocusHud session={session} controlsVisible={controlsVisible} onExit={exit} /> : null}
      {status === "running" && !inFocus ? (
        // Sized to read from the bar, two to three metres from the screen.
        <div className="absolute inset-x-3 bottom-3 flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-black/65 p-3 text-white backdrop-blur sm:inset-x-5 sm:bottom-5 sm:px-5 sm:py-4">
          <div className="flex min-w-0 items-center gap-3 sm:gap-4">
            <p className="text-5xl leading-none font-semibold tracking-[-0.04em] tabular-nums sm:text-7xl">
              {snapshot.validRepCount}
              <span className="sr-only"> completed {snapshot.validRepCount === 1 ? "rep" : "reps"}</span>
            </p>
            <div className="min-w-0">
              <p className="font-mono text-[0.58rem] tracking-[0.14em] text-white/60 uppercase" aria-hidden="true">
                {snapshot.validRepCount === 1 ? "Rep" : "Reps"}
              </p>
              <p className="mt-1 line-clamp-2 text-sm leading-5 font-medium sm:truncate sm:text-lg">{cue.title}</p>
            </div>
          </div>
          <Button type="button" variant="outline" size="lg" onClick={stopSession} className="shrink-0 gap-2 border-white/30 bg-black/45 text-white hover:bg-white/10 hover:text-white lg:hidden">
            <Square className="size-3.5 fill-current" /> Stop
          </Button>
        </div>
      ) : null}
    </div>
    </>
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
