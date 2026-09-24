import Link from "next/link";
import { Camera, Check, CircleAlert, RefreshCw, Square, Volume2, VolumeX } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { useLiveCoachSession } from "../hooks/use-live-coach-session.ts";
import { LIVE_VERTICAL_PULL_MOVEMENTS, PARTIAL_VERTICAL_PULL_VARIANTS, verticalPullVariantLabel } from "../vertical-pull-config.ts";

type Props = { session: ReturnType<typeof useLiveCoachSession> };

export function SessionPanel({ session }: Props) {
  const {
    status, snapshot, cue, errorMessage, hasLiveCoachAccess, access,
    safetyAcknowledged, setSafetyAcknowledged, isActive, voiceEnabled,
    toggleVoice, devices, selectedDeviceId, setSelectedDeviceId,
    startSession, stopSession,
  } = session;
  const phaseLabel = snapshot.phase === "unknown" ? "Finding start" : snapshot.phase;

  return (
    <aside className="flex flex-col border-t border-border lg:border-t-0 lg:border-l">
      <div className="border-b border-border p-5 sm:p-6">
        <Label htmlFor="live-coach-movement" className="font-mono text-[0.56rem] font-semibold tracking-[0.14em] text-primary uppercase">
          Movement family
        </Label>
        <Select defaultValue="vertical-pull">
          <SelectTrigger id="live-coach-movement" className="mt-2 h-11 w-full rounded-xl bg-background/70">
            <SelectValue />
          </SelectTrigger>
          <SelectContent><SelectItem value="vertical-pull">Vertical Pull</SelectItem></SelectContent>
        </Select>
        <p className="mt-2 text-xs leading-5 text-foreground-faint">
          Reps use visible width and upper-torso height evidence. Grip stays uncertain when the camera cannot establish palm direction. Other families are not yet available.
        </p>
      </div>

      <div className="grid grid-cols-2 border-b border-border">
        <Metric label="Completed reps" value={String(snapshot.validRepCount)} />
        <Metric label="Current phase" value={phaseLabel} capitalize />
      </div>

      <div className="border-b border-border px-5 py-4 sm:px-6">
        <p className="font-mono text-[0.56rem] font-semibold tracking-[0.14em] text-primary uppercase">
          Rep breakdown
        </p>
        <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:text-sm">
          {LIVE_VERTICAL_PULL_MOVEMENTS.map((movement) => (
            <div key={movement.slug} className="flex justify-between gap-2 text-foreground-soft">
              <span>{movement.label}</span><span className="font-mono">{snapshot.variantBreakdown[movement.slug]}</span>
            </div>
          ))}
          {PARTIAL_VERTICAL_PULL_VARIANTS.filter((variant) => snapshot.variantBreakdown[variant.slug] > 0)
            .map((variant) => (
              <div key={variant.slug} className="flex justify-between gap-2 text-foreground-soft">
                <span>{variant.label}</span><span className="font-mono">{snapshot.variantBreakdown[variant.slug]}</span>
              </div>
            ))}
          <div className="flex justify-between gap-2 text-foreground-soft">
            <span>Unknown variant</span><span className="font-mono">{snapshot.variantBreakdown.unknown}</span>
          </div>
        </div>
        {snapshot.latestRep?.outcome === "valid" ? (
          <div className="mt-2 text-xs text-foreground-faint">
            <p>Last rep: {verticalPullVariantLabel(snapshot.latestRep.classification?.variant ?? "unknown")}</p>
            {snapshot.latestRep.classification ? (
              <p className="mt-1">
                Grip: {snapshot.latestRep.classification.grip} · Width: {snapshot.latestRep.classification.width} · Height: {snapshot.latestRep.classification.height}
              </p>
            ) : null}
          </div>
        ) : null}
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
            {access.isPending ? (
              "Checking Live Coach access…"
            ) : access.isError ? (
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
        <div className="flex items-start gap-3 rounded-xl border border-border bg-background-alt/60 p-3">
          <Checkbox
            id="live-coach-safety"
            checked={safetyAcknowledged}
            onCheckedChange={(checked) => setSafetyAcknowledged(checked === true)}
            disabled={isActive}
          />
          <div>
            <Label htmlFor="live-coach-safety" className="cursor-pointer text-sm leading-5 font-normal">
              I checked the bar and space, can hang comfortably, and will stop if grip or body control breaks down.
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
              Active camera: {devices.find((device) => device.deviceId === selectedDeviceId)?.label ?? "Default"}. Stop the session to switch cameras.
            </p>
          </div>
        ) : (
          <p className="text-xs leading-5 text-foreground-faint">
            Camera choices appear after first permission. Place the selected camera in front of the bar.
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
