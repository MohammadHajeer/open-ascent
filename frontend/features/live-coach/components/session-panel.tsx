import Link from "next/link";
import { Camera, Check, CircleAlert, Info, RefreshCw, Square, Volume2, VolumeX } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { useLiveCoachSession } from "../hooks/use-live-coach-session.ts";
import type { PullUpPhase, PullUpRep } from "../types.ts";
import {
  LIVE_VERTICAL_PULL_MOVEMENTS,
  PARTIAL_VERTICAL_PULL_VARIANTS,
  verticalPullVariantLabel,
} from "../vertical-pull-config.ts";

type Props = { session: ReturnType<typeof useLiveCoachSession> };

const PHASE_LABELS: Record<PullUpPhase, string> = {
  unknown: "Setting up",
  bottom: "Hang",
  rising: "Pulling",
  top: "Top",
  lowering: "Lowering",
};

const PUSH_UP_PHASE_LABELS: Record<PullUpPhase, string> = {
  ...PHASE_LABELS, bottom: "Bottom", rising: "Pressing up",
};

const VARIANTS = [...LIVE_VERTICAL_PULL_MOVEMENTS, ...PARTIAL_VERTICAL_PULL_VARIANTS];

function attributeLabel(value: string) {
  return value === "unknown" ? "Unclear" : value.charAt(0).toUpperCase() + value.slice(1);
}

function lastRepDetail(classification: NonNullable<PullUpRep["classification"]>) {
  const parts = [`Width: ${attributeLabel(classification.width)}`, `Height: ${attributeLabel(classification.height)}`];
  // Grip is unknown for every pose-only rep; the family note already says so.
  if (classification.grip !== "unknown") parts.unshift(`Grip: ${attributeLabel(classification.grip)}`);
  return parts.join(" · ");
}

export function SessionPanel({ session }: Props) {
  const {
    status, snapshot, cue, errorMessage, hasLiveCoachAccess, access,
    safetyAcknowledged, setSafetyAcknowledged, isActive, voiceEnabled,
    toggleVoice, devices, selectedDeviceId, setSelectedDeviceId,
    startSession, stopSession, movement, selectMovement,
  } = session;
  const isPushUp = movement === "push-up";
  const breakdown = [
    ...VARIANTS.filter((variant) => snapshot.variantBreakdown[variant.slug] > 0),
    ...(snapshot.variantBreakdown.unknown > 0 ? [{ slug: "unknown" as const, label: "Unclassified" }] : []),
  ];
  const latestValidRep = snapshot.latestRep?.outcome === "valid" ? snapshot.latestRep : null;

  return (
    <aside className="flex flex-col border-t border-border lg:border-t-0 lg:border-l">
      <div className="border-b border-border p-5 sm:p-6">
        <Label htmlFor="live-coach-movement" className="font-mono text-[0.56rem] font-semibold tracking-[0.14em] text-primary uppercase">
          Movement family
        </Label>
        <Select value={movement} onValueChange={(value) => {
          if (value === "vertical-pull" || value === "push-up") selectMovement(value);
        }}>
          <SelectTrigger id="live-coach-movement" className="mt-2 h-11 w-full rounded-xl bg-background/70">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="vertical-pull">Vertical Pull (Pull-Up)</SelectItem>
            <SelectItem value="push-up">Push-Up</SelectItem>
          </SelectContent>
        </Select>
        <p className="mt-2 text-xs leading-5 text-foreground-faint">
          {isPushUp
            ? "Use a side or mostly-side view with your shoulder, elbow, wrist, hip, and ankle visible. Begin with extended arms. Changing movement stops the session and resets the count."
            : "Counts pull-ups, chin-ups, and their width and height variations. The camera can't reliably see which way your palms face, so reps are labeled by hand width and pull height. Changing movement stops the session and resets the count."}
        </p>
      </div>

      <div className="grid grid-cols-2 border-b border-border">
        <Metric label="Completed reps" value={String(snapshot.validRepCount)} />
        <Metric label="Current phase" value={isPushUp
          ? PUSH_UP_PHASE_LABELS[snapshot.phase]
          : PHASE_LABELS[snapshot.phase]} />
      </div>

      {!isPushUp ? <div className="border-b border-border px-5 py-4 sm:px-6">
        <p className="font-mono text-[0.56rem] font-semibold tracking-[0.14em] text-primary uppercase">
          Rep breakdown
        </p>
        {breakdown.length ? (
          <dl className="mt-2 grid gap-y-1 text-xs sm:text-sm">
            {breakdown.map((variant) => (
              <div key={variant.slug} className="flex justify-between gap-2 text-foreground-soft">
                <dt>{variant.label}</dt>
                <dd className="font-mono">{snapshot.variantBreakdown[variant.slug]}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="mt-2 text-xs leading-5 text-foreground-faint">
            Completed reps are grouped here by the width and height the camera can see.
          </p>
        )}
        {latestValidRep ? (
          <div className="mt-2 text-xs leading-5 text-foreground-faint">
            <p>Last rep: {verticalPullVariantLabel(latestValidRep.classification?.variant ?? "unknown")}</p>
            {latestValidRep.classification ? <p>{lastRepDetail(latestValidRep.classification)}</p> : null}
          </div>
        ) : null}
      </div> : null}

      <div className="flex-1 p-5 sm:p-6">
        <p className="font-mono text-[0.56rem] font-semibold tracking-[0.14em] text-primary uppercase">
          Coach cue
        </p>
        <div
          className={cn(
            "mt-3 rounded-2xl border p-5",
            cue.tone === "attention"
              ? "border-warning/35 bg-warning/8"
              : "border-primary/20 bg-primary-light",
          )}
          role="status"
          aria-live="polite"
        >
          <div className="flex items-start gap-3">
            {cue.tone === "attention" ? (
              <CircleAlert className="mt-0.5 size-5 shrink-0 text-warning" />
            ) : cue.tone === "positive" ? (
              <Check className="mt-0.5 size-5 shrink-0 text-primary" />
            ) : (
              <Info className="mt-0.5 size-5 shrink-0 text-primary" />
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
          <Alert variant="destructive" className="mt-4">
            <CircleAlert />
            <AlertDescription>{errorMessage}</AlertDescription>
          </Alert>
        ) : null}

        {!hasLiveCoachAccess ? (
          <Alert role="status" className="mt-4">
            <AlertDescription>
              {access.isPending ? (
                "Checking Live Coach access…"
              ) : access.isError ? (
                <span className="flex flex-wrap items-center justify-between gap-2">
                  We couldn&apos;t confirm your Live Coach access.
                  <Button type="button" variant="outline" size="sm" onClick={() => void access.refetch()} disabled={access.isFetching}>
                    <RefreshCw className={cn("size-3.5", access.isFetching && "animate-spin")} />
                    Try again
                  </Button>
                </span>
              ) : (
                <>
                  Live Coach is included with Pro. Safety guidance remains
                  available on every plan.{" "}
                  <Link href="/dashboard/settings" className="font-medium text-primary">
                    View plan
                  </Link>
                </>
              )}
            </AlertDescription>
          </Alert>
        ) : null}
      </div>

      <div className="space-y-4 border-t border-border p-5 sm:p-6">
        <div className="flex items-start gap-3 rounded-xl border border-border bg-background-alt/60 p-3">
          <Checkbox
            id="live-coach-safety"
            checked={safetyAcknowledged}
            onCheckedChange={(checked) => setSafetyAcknowledged(checked === true)}
            disabled={isActive}
          />
          <div>
            <Label htmlFor="live-coach-safety" className="cursor-pointer text-sm leading-5 font-normal">
              {isPushUp
                ? "I checked the floor and space, can support myself comfortably, and will stop if body control breaks down."
                : "I checked the bar and space, can hang comfortably, and will stop if grip or body control breaks down."}
            </Label>
            <a href="#live-coach-safety-guidance" className="mt-1 inline-block text-xs font-medium text-primary underline underline-offset-4">Read safety guidance</a>
          </div>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="gap-2"
          aria-pressed={voiceEnabled}
          onClick={toggleVoice}
        >
          {voiceEnabled ? <Volume2 className="size-4" /> : <VolumeX className="size-4" />}
          Voice coach {voiceEnabled ? "on" : "off"}
        </Button>
        {devices.length > 1 ? (
          <div className="space-y-2">
            <Label htmlFor="live-coach-camera">Camera</Label>
            <Select
              items={devices.map((device) => ({ value: device.deviceId, label: device.label || "Camera" }))}
              value={selectedDeviceId}
              onValueChange={(value) => { if (value) setSelectedDeviceId(value); }}
              disabled={isActive}
            >
              <SelectTrigger id="live-coach-camera" className="h-10 w-full rounded-xl bg-background/70">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {devices.map((device) => (
                  <SelectItem key={device.deviceId} value={device.deviceId}>
                    {device.label || "Camera"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs leading-5 text-foreground-faint">
              {isActive ? "Stop the session to switch cameras." : "The selected camera is used when you start."}
            </p>
          </div>
        ) : (
          <p className="text-xs leading-5 text-foreground-faint">
            Camera choices appear after first permission. {isPushUp ? "Place the selected camera beside you." : "Place the selected camera in front of the bar."}
          </p>
        )}

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
            disabled={!safetyAcknowledged || !hasLiveCoachAccess || isActive}
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
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="p-5 sm:p-6">
      <p className="font-mono text-[0.54rem] font-semibold tracking-[0.12em] text-foreground-faint uppercase">
        {label}
      </p>
      <p className="mt-2 text-2xl font-medium tracking-[-0.04em]">{value}</p>
    </div>
  );
}
