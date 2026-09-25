import { Gauge, LockKeyhole, ShieldCheck } from "lucide-react";

import type { useLiveCoachSession } from "../hooks/use-live-coach-session.ts";

type Props = { session: ReturnType<typeof useLiveCoachSession> };

export function SessionDetails({ session }: Props) {
  const { fps, inferenceMs, initializationMs, delegate } = session;
  const estimatedCueLatency = fps > 0 ? Math.round(1000 / fps + inferenceMs) : null;

  return (
    <section className="grid gap-4 lg:grid-cols-[minmax(0,1.25fr)_minmax(300px,0.75fr)]">
      <div id="live-coach-safety-guidance" className="scroll-mt-6 rounded-[1.6rem] border border-border bg-card/65 p-5 sm:p-7">
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
          The browser downloads the MediaPipe pose model and code from public
          CDNs, plus the coach&apos;s voice clips. Camera frames go straight from
          the video preview to on-device tracking; they are not recorded,
          encoded, uploaded, or saved.
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
          {delegate ? `Running on ${delegate} · 12 fps target` : "12 fps target · measured when running"}
        </p>
      </div>
    </section>
  );
}

function SmallMetric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="font-mono text-[0.52rem] tracking-widest text-foreground-faint uppercase">
        {label}
      </p>
      <p className="mt-1 text-sm font-medium">{value}</p>
    </div>
  );
}
