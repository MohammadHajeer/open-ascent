import { CircleAlert } from "lucide-react";

import type { MovementSafetyContent } from "../_lib/types";

export function CautionsSection({
  content,
}: {
  content: MovementSafetyContent;
}) {
  return (
    <section
      className="border-b border-border bg-background"
      aria-labelledby="cautions-title"
    >
      <div className="mx-auto grid w-full max-w-360 gap-12 px-4 py-20 sm:px-5 sm:py-24 lg:grid-cols-[0.36fr_0.64fr] lg:gap-20 lg:py-28">
        <div>
          <span className="font-mono text-[0.58rem] font-semibold tracking-widest text-primary uppercase">
            02 / Cautions
          </span>
          <h2
            id="cautions-title"
            className="mt-4 text-[clamp(2.8rem,5vw,4.8rem)] leading-[0.92] font-medium tracking-[-0.06em] text-foreground"
          >
            Things to consider before the attempt.
          </h2>
        </div>

        {content.cautions.length > 0 ? (
          <ul className="border-t border-border">
            {content.cautions.map((caution) => (
              <li
                className="flex gap-4 border-b border-border py-5 text-sm leading-6 text-foreground-soft sm:text-base sm:leading-7"
                key={caution}
              >
                <CircleAlert
                  className="mt-1 size-4 shrink-0 text-primary"
                  aria-hidden="true"
                />
                {caution}
              </li>
            ))}
          </ul>
        ) : (
          <p className="border-y border-border py-6 text-sm leading-6 text-foreground-soft sm:text-base sm:leading-7">
            No additional movement-specific cautions are listed in this
            published guide.
          </p>
        )}
      </div>
    </section>
  );
}
