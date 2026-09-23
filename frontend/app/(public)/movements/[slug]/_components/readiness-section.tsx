import { Check, Crosshair } from "lucide-react";

import { Badge } from "@/components/ui/badge";

import type { MovementSafetyContent } from "../_lib/types";

export function ReadinessSection({
  content,
}: {
  content: MovementSafetyContent;
}) {
  return (
    <section
      className="overflow-hidden bg-visual-surface text-visual-foreground"
      aria-labelledby="readiness-title"
    >
      <div className="relative mx-auto w-full max-w-360 px-4 py-20 sm:px-5 sm:py-24 lg:py-28">
        <div
          className="cv-grid pointer-events-none absolute inset-0 opacity-[0.07]"
          aria-hidden="true"
        />

        <div className="relative grid gap-10 lg:grid-cols-[0.42fr_0.58fr] lg:gap-20">
          <div>
            <Badge
              variant="outline"
              className="border-visual-foreground/20 text-visual-foreground/70"
            >
              <Crosshair aria-hidden="true" />
              Readiness guidance
            </Badge>

            <h2
              id="readiness-title"
              className="mt-6 text-[clamp(3rem,6vw,5.8rem)] leading-[0.9] font-medium tracking-[-0.065em]"
            >
              Check the prerequisites first.
            </h2>

            <p className="mt-6 max-w-lg text-sm leading-6 text-visual-foreground/62 sm:text-base sm:leading-7">
              Review these movement-specific safety notes before training.
              Measurable prerequisites can be checked against recorded evidence;
              the remaining notes are guidance.
            </p>

            {content.easier_option ? (
              <aside className="mt-8 border-l border-primary pl-5">
                <span className="font-mono text-[0.54rem] tracking-widest text-primary uppercase">
                  Easier option
                </span>
                <p className="mt-2 text-sm leading-6 text-visual-foreground/80">
                  {content.easier_option}
                </p>
              </aside>
            ) : null}
          </div>

          {content.prerequisites.length > 0 ? (
            <ul className="grid border-t border-visual-foreground/15 sm:grid-cols-2 lg:self-end">
              {content.prerequisites.map((prerequisite, index) => (
                <li
                  className="flex min-h-28 gap-4 border-b border-visual-foreground/15 py-6 sm:border-r sm:px-6 sm:even:border-r-0 lg:min-h-32"
                  key={prerequisite}
                >
                  <span className="grid size-7 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground">
                    <Check className="size-3.5" aria-hidden="true" />
                  </span>
                  <div>
                    <span className="font-mono text-[0.54rem] tracking-widest text-primary uppercase">
                      Prerequisite {String(index + 1).padStart(2, "0")}
                    </span>
                    <p className="mt-2 text-sm leading-6 text-visual-foreground/80">
                      {prerequisite}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <div className="border-y border-visual-foreground/15 py-8 text-sm leading-6 text-visual-foreground/70 lg:self-end">
              No additional movement-specific prerequisites are listed in this
              published guide.
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
