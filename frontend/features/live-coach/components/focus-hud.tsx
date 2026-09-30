import { Camera, Minimize2, RefreshCw, Square } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { useLiveCoachSession } from "../hooks/use-live-coach-session.ts";
import { MOVEMENT_NAMES, phaseLabels } from "../labels.ts";

type Props = {
  session: ReturnType<typeof useLiveCoachSession>;
  controlsVisible: boolean;
  onExit: () => void;
};

// The camera surface is always dark, so accents use fixed on-dark values
// (the olive matches the pose skeleton) instead of theme tokens.
const TONE_MARK = {
  positive: "bg-[#a7b28f]",
  attention: "bg-[#d6a75a]",
  neutral: "bg-white/45",
} as const;

const controlClass = "gap-2 border-white/25 bg-black/50 text-white backdrop-blur hover:bg-white/10 hover:text-white";

export function FocusHud({ session, controlsVisible, onExit }: Props) {
  const {
    status, snapshot, cue, movement, isActive, errorMessage,
    safetyAcknowledged, hasLiveCoachAccess, startSession, stopSession,
  } = session;
  const running = status === "running";
  const cameraBlank = (running || status === "loading-pose") && session.cameraSignal === "blank";
  const slowTracking = running && !cameraBlank && session.lowTrackingRate;
  const reps = snapshot.validRepCount;
  const stateLabel = running
    ? phaseLabels(movement)[snapshot.phase]
    : isActive
      ? "Starting"
      : status === "stopped" && reps > 0 ? "Set complete" : "Camera off";
  const message = running ? cue.title : status === "error" ? errorMessage : null;
  const canRestart = !isActive && safetyAcknowledged && hasLiveCoachAccess;

  return (
    <>
      <div className="pointer-events-none absolute inset-0 text-visual-foreground">
        {/* Local scrims keep the type legible over bright gyms without dimming the athlete. */}
        <div className="absolute inset-x-0 top-0 h-[38%] bg-linear-to-b from-black/60 via-black/20 to-transparent" />
        <div className="absolute inset-x-0 bottom-0 h-[36%] bg-linear-to-t from-black/65 via-black/25 to-transparent" />

        <div className="absolute top-[max(1.25rem,env(safe-area-inset-top))] left-5 sm:top-8 sm:left-8 lg:top-11 lg:left-12">
          <h2 className="text-[clamp(1.6rem,3.3vw,3.6rem)] leading-[0.9] font-semibold tracking-[-0.045em] uppercase">
            {MOVEMENT_NAMES[movement]}
          </h2>
          <p className="mt-3 flex items-center gap-2 font-mono text-[clamp(0.58rem,0.72vw,0.8rem)] tracking-[0.18em] text-visual-foreground/60 uppercase lg:mt-4">
            <span className={cn("size-1.5 rounded-full", cameraBlank || slowTracking ? TONE_MARK.attention : running && snapshot.poseReady ? TONE_MARK.positive : "bg-white/30")} />
            {cameraBlank ? "No camera image" : slowTracking ? `Slow tracking · ${Math.round(session.fps)} fps` : "On-device tracking"}
          </p>
        </div>

        <div className="absolute top-[max(1rem,env(safe-area-inset-top))] right-5 text-right sm:top-6 sm:right-8 lg:top-8 lg:right-12">
          <p className="text-[clamp(4.25rem,min(12.5vw,23vh),14.5rem)] leading-[0.85] font-semibold tracking-[-0.06em] tabular-nums">
            {String(reps).padStart(2, "0")}
            <span className="sr-only"> completed {reps === 1 ? "rep" : "reps"}</span>
          </p>
          <p className="mt-2 font-mono text-[clamp(0.7rem,1vw,1.1rem)] tracking-[0.18em] text-visual-foreground/70 uppercase">
            {stateLabel}
          </p>
        </div>

        {message ? (
          <div className="absolute inset-x-5 bottom-22 flex flex-col items-center text-center sm:bottom-10 lg:bottom-14">
            <span className={cn("h-0.75 w-10 rounded-full", running ? TONE_MARK[cue.tone] : TONE_MARK.attention)} aria-hidden="true" />
            <p
              role="status"
              aria-live="polite"
              className={cn(
                "mt-4 max-w-[22ch] font-semibold text-balance uppercase [text-shadow:0_2px_24px_rgba(0,0,0,0.45)]",
                running
                  ? "text-[clamp(1.6rem,4.1vw,4.6rem)] leading-[0.98] tracking-[-0.035em]"
                  : "max-w-[42ch] text-[clamp(1rem,1.6vw,1.6rem)] leading-tight tracking-[-0.02em] normal-case",
              )}
            >
              {message}
            </p>
          </div>
        ) : null}
      </div>

      <div
        className={cn(
          "absolute inset-x-4 bottom-[max(1rem,env(safe-area-inset-bottom))] z-10 flex justify-center gap-2 transition-opacity duration-300",
          "sm:inset-x-auto sm:top-8 sm:bottom-auto sm:left-1/2 sm:-translate-x-1/2 lg:top-11",
          controlsVisible
            ? "opacity-100"
            : "pointer-events-none opacity-0 has-[:focus-visible]:pointer-events-auto has-[:focus-visible]:opacity-100",
        )}
      >
        {running || isActive ? (
          <Button type="button" variant="outline" onClick={stopSession} className={controlClass}>
            <Square className="size-3 fill-current" /> Stop
          </Button>
        ) : canRestart ? (
          <Button type="button" variant="outline" onClick={() => void startSession()} className={controlClass}>
            {status === "idle" ? <Camera className="size-3.5" /> : <RefreshCw className="size-3.5" />}
            {status === "idle" ? "Start" : "Restart"}
          </Button>
        ) : null}
        <Button type="button" variant="outline" onClick={onExit} className={controlClass}>
          <Minimize2 className="size-3.5" />
          Exit focus
          <kbd className="ml-1 hidden rounded border border-white/20 px-1.5 py-0.5 font-mono text-[0.6rem] leading-none text-white/60 sm:inline">Esc</kbd>
        </Button>
      </div>
    </>
  );
}
