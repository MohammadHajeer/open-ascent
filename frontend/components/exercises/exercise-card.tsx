import Image from "next/image";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";

import { cn } from "@/lib/utils";

export type MovementListItem = {
  id: string;
  slug: string;
  name: string;
  family_key: string;
  difficulty: "beginner" | "intermediate" | "advanced";
  illustration_url: string | null;
  upload_analysis_supported: boolean;
  live_coach_supported: boolean;
};

function formatFamilyName(familyKey: string) {
  return familyKey
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function formatDifficulty(difficulty: MovementListItem["difficulty"]) {
  return difficulty.charAt(0).toUpperCase() + difficulty.slice(1);
}

export function ExerciseCard({
  exercise,
  compact = false,
  eager = false,
}: {
  exercise: MovementListItem;
  compact?: boolean;
  eager?: boolean;
}) {
  return (
    <Link
      href={`/movements/${exercise.slug}`}
      className="group block rounded-[3px_3px_30px_3px] outline-none transition-transform duration-300 hover:-translate-y-1 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4 focus-visible:ring-offset-background"
      aria-label={`Learn the ${exercise.name}`}
    >
      <article className="overflow-hidden rounded-[inherit] border border-border bg-card transition-colors duration-300 group-hover:border-primary/55">
        <div
          className={cn(
            "relative isolate overflow-hidden border-b border-border bg-background-alt",
            compact ? "aspect-5/4" : "aspect-4/3",
          )}
        >
          <div
            className="cv-grid absolute inset-0 -z-10 opacity-20"
            aria-hidden="true"
          />

          <span
            className="absolute top-[12%] left-[18%] aspect-square w-[64%] rounded-full bg-primary-light transition-transform duration-500 group-hover:scale-105"
            aria-hidden="true"
          />

          {exercise.illustration_url ? (
            <div className="absolute inset-[4%_3%_2%] transition-transform duration-500 ease-out group-hover:-translate-y-1.5 group-hover:scale-[1.015]">
              <Image
                src={exercise.illustration_url}
                alt={`${exercise.name} movement illustration`}
                fill
                priority={eager}
                sizes={
                  compact
                    ? "(max-width: 768px) 100vw, 33vw"
                    : "(max-width: 768px) 100vw, (max-width: 1280px) 50vw, 33vw"
                }
                className="object-contain drop-shadow-[0_18px_24px_rgba(28,28,26,0.1)]"
              />
            </div>
          ) : (
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="font-mono text-[0.58rem] tracking-widest text-foreground-faint uppercase">
                Illustration unavailable
              </span>
            </div>
          )}
        </div>

        <div className={cn("p-5 sm:p-6", compact && "sm:p-5")}>
          <span className="font-mono text-[0.57rem] font-semibold tracking-widest text-foreground-faint uppercase">
            {formatFamilyName(exercise.family_key)}
          </span>

          <h3
            className={cn(
              "mt-2 font-medium tracking-tighter text-foreground",
              compact ? "text-2xl" : "text-3xl sm:text-[2.1rem]",
            )}
          >
            {exercise.name}
          </h3>

          <div className="mt-5 flex items-center justify-between gap-4 border-t border-border pt-4">
            <span className="text-xs text-foreground-soft">
              {formatDifficulty(exercise.difficulty)}
            </span>

            <span className="inline-flex items-center gap-2 text-xs font-semibold text-foreground transition-colors group-hover:text-primary">
              Learn movement
              <ArrowUpRight
                className="size-3.5 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5"
                aria-hidden="true"
              />
            </span>
          </div>
        </div>
      </article>
    </Link>
  );
}
