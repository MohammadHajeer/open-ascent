import Link from "next/link";
import { ArrowUpRight, Check, CircleAlert, Radio, ScanLine } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";

import type { MovementGuide } from "../_lib/types";

function Capability({
  available,
  icon: Icon,
  title,
  availableText,
  unavailableText,
}: {
  available: boolean;
  icon: typeof ScanLine;
  title: string;
  availableText: string;
  unavailableText: string;
}) {
  return (
    <div className="border-t border-border py-5 first:border-t-0 sm:first:border-t">
      <div className="flex items-start gap-4">
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-primary-light text-primary">
          <Icon className="size-4" aria-hidden="true" />
        </span>
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-foreground">{title}</h3>
            {available ? (
              <Check className="size-3.5 text-primary" aria-hidden="true" />
            ) : (
              <CircleAlert
                className="size-3.5 text-foreground-faint"
                aria-hidden="true"
              />
            )}
          </div>
          <p className="mt-2 text-sm leading-6 text-foreground-soft">
            {available ? availableText : unavailableText}
          </p>
        </div>
      </div>
    </div>
  );
}

export function MovementCapabilities({
  movement,
}: {
  movement: MovementGuide;
}) {
  return (
    <section className="border-b border-border bg-background">
      <div className="mx-auto grid w-full max-w-360 gap-10 px-4 py-16 sm:px-5 sm:py-20 lg:grid-cols-[0.44fr_0.56fr] lg:gap-20">
        <div>
          <span className="font-mono text-[0.57rem] font-semibold tracking-widest text-primary uppercase">
            Open Ascent support
          </span>
          <h2 className="mt-3 text-[clamp(2.6rem,5vw,4.8rem)] leading-[0.92] font-medium tracking-[-0.06em] text-foreground">
            Guide availability is separate from coaching support.
          </h2>
          <p className="mt-5 max-w-xl text-sm leading-6 text-foreground-soft">
            This published safety guide stays readable even when analysis or
            Live Coach support is not yet enabled for the movement.
          </p>

          {movement.upload_analysis_supported ? (
            <Link
              href={`/analyze?movement=${encodeURIComponent(movement.slug)}`}
              className={`${buttonVariants({ variant: "brand", size: "lg" })} mt-7`}
            >
              Analyze a video
              <ArrowUpRight className="size-4" />
            </Link>
          ) : null}
        </div>

        <div className="lg:self-end">
          <Capability
            available={movement.upload_analysis_supported}
            icon={ScanLine}
            title="Uploaded video analysis"
            availableText="This movement can currently be selected for uploaded-video analysis."
            unavailableText="Uploaded-video analysis is not currently enabled for this movement."
          />
          <Capability
            available={movement.live_coach_supported}
            icon={Radio}
            title="Live Coach"
            availableText="Live Coach support is currently enabled for this movement."
            unavailableText="Live Coach support is not currently enabled for this movement."
          />
        </div>
      </div>
    </section>
  );
}
