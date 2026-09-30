import { useState } from "react";

type Copy = { title: string; description: string };

const titleClass =
  "text-[clamp(2rem,4vw,3.5rem)] leading-none font-medium tracking-[-0.06em]";
const descriptionClass = "mt-3 text-sm text-foreground-soft";

/**
 * Crossfades the analysis headline when the real status copy changes: the
 * previous line lifts out while the new one rises into the same grid cell, so
 * the header reads as one surface evolving rather than a hard swap.
 */
export function StatusHeadline({ title, description }: Copy) {
  const [shown, setShown] = useState<Copy>({ title, description });
  const [leaving, setLeaving] = useState<(Copy & { id: number }) | null>(null);

  // Adjusting state during render keeps the outgoing copy for exactly one exit.
  if (shown.title !== title) {
    setLeaving({ ...shown, id: (leaving?.id ?? 0) + 1 });
    setShown({ title, description });
  } else if (shown.description !== description) {
    setShown({ title, description });
  }

  return (
    <div className="grid">
      {leaving ? (
        <div
          key={`leaving-${leaving.id}`}
          aria-hidden="true"
          className="pointer-events-none [grid-area:1/1] fade-out slide-out-to-top-2 duration-200 ease-in fill-mode-forwards motion-safe:animate-out motion-reduce:hidden"
          onAnimationEnd={(event) => {
            if (event.target === event.currentTarget) setLeaving(null);
          }}
        >
          <p className={titleClass}>{leaving.title}</p>
          <p className={descriptionClass}>{leaving.description}</p>
        </div>
      ) : null}

      <div key={title} className="[grid-area:1/1]">
        <h2 className={`${titleClass} fade-in slide-in-from-bottom-2 duration-300 ease-out delay-75 fill-mode-backwards motion-safe:animate-in`}>
          {title}
        </h2>
        <p className={`${descriptionClass} fade-in slide-in-from-bottom-1 duration-300 ease-out delay-150 fill-mode-backwards motion-safe:animate-in`}>
          {description}
        </p>
      </div>
    </div>
  );
}
