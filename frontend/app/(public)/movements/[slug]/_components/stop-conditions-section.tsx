import { OctagonAlert } from "lucide-react";

import type { MovementSafetyContent } from "../_lib/types";

export function StopConditionsSection({
  content,
}: {
  content: MovementSafetyContent;
}) {
  return (
    <section
      className="border-b border-border bg-background-alt"
      aria-labelledby="stop-title"
    >
      <div className="mx-auto w-full max-w-360 px-4 py-20 sm:px-5 sm:py-24 lg:py-28">
        <div className="grid gap-8 lg:grid-cols-[0.38fr_0.62fr] lg:gap-20">
          <div>
            <span className="font-mono text-[0.58rem] font-semibold tracking-widest text-primary uppercase">
              03 / Stop conditions
            </span>
            <h2
              id="stop-title"
              className="mt-4 text-[clamp(2.8rem,5vw,4.8rem)] leading-[0.92] font-medium tracking-[-0.06em] text-foreground"
            >
              Know when to stop.
            </h2>
            <p className="mt-5 max-w-lg text-sm leading-6 text-foreground-soft">
              Stop guidance is always available as part of the published
              movement reference and is independent from AI or subscription
              access.
            </p>
          </div>

          <ol className="border-t border-border">
            {content.stop_conditions.map((condition, index) => (
              <li
                key={condition}
                className="grid gap-4 border-b border-border py-6 sm:grid-cols-[64px_minmax(0,1fr)] sm:items-start sm:gap-6"
              >
                <span className="grid size-9 place-items-center rounded-full border border-primary/30 text-primary">
                  <OctagonAlert className="size-4" aria-hidden="true" />
                </span>
                <div>
                  <span className="font-mono text-[0.54rem] tracking-widest text-primary uppercase">
                    Stop {String(index + 1).padStart(2, "0")}
                  </span>
                  <p className="mt-2 text-sm leading-6 text-foreground-soft sm:text-base sm:leading-7">
                    {condition}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}
