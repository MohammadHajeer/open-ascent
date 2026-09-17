import { CircleDot, Wrench } from "lucide-react";

import type { MovementSafetyContent } from "../_lib/types";

export function SafetyOverview({
  content,
}: {
  content: MovementSafetyContent;
}) {
  return (
    <section
      className="border-b border-border bg-background"
      aria-labelledby="overview-title"
    >
      <div className="mx-auto w-full max-w-360 px-4 py-20 sm:px-5 sm:py-24 lg:py-28">
        <div className="grid gap-8 lg:grid-cols-[0.32fr_0.68fr] lg:gap-20">
          <div>
            <span className="font-mono text-[0.58rem] font-semibold tracking-widest text-primary uppercase">
              01 / Safety overview
            </span>
            <h2
              id="overview-title"
              className="mt-4 text-3xl font-medium tracking-tighter text-foreground sm:text-4xl"
            >
              Know what the movement asks of you.
            </h2>
          </div>

          <div className="grid gap-8 sm:grid-cols-2">
            <div>
              <div className="flex items-center gap-3">
                <CircleDot className="size-4 text-primary" aria-hidden="true" />
                <h3 className="text-sm font-semibold text-foreground">
                  Stressed areas
                </h3>
              </div>
              <ul className="mt-5 border-t border-border">
                {content.stressed_areas.map((area) => (
                  <li
                    key={area}
                    className="border-b border-border py-4 text-sm leading-6 text-foreground-soft"
                  >
                    {area}
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <div className="flex items-center gap-3">
                <Wrench className="size-4 text-primary" aria-hidden="true" />
                <h3 className="text-sm font-semibold text-foreground">
                  Setup
                </h3>
              </div>

              {content.setup && content.setup.length > 0 ? (
                <ul className="mt-5 border-t border-border">
                  {content.setup.map((item) => (
                    <li
                      key={item}
                      className="border-b border-border py-4 text-sm leading-6 text-foreground-soft"
                    >
                      {item}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-5 border-t border-border pt-4 text-sm leading-6 text-foreground-soft">
                  No additional movement-specific setup guidance is listed.
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
