import Image from "next/image";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { publicApiFetchOr } from "@/lib/public-api";
import { cn } from "@/lib/utils";

type MovementListItem = {
  id: string;
  slug: string;
  name: string;
  family_key: string;
  difficulty: "beginner" | "intermediate" | "advanced";
  illustration_url: string | null;
  upload_analysis_supported: boolean;
  live_coach_supported: boolean;
};

const featuredSlugs = [
  "pull-up",
  "front-lever",
  "push-up",
  "chin-up",
  "dips",
  "back-lever",
] as const;

function formatFamilyLabel(familyKey: string) {
  return familyKey
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function ExerciseMeta({
  number,
  movement,
  inverse = false,
}: {
  number: string;
  movement: MovementListItem;
  inverse?: boolean;
}) {
  return (
    <div className="relative z-10 flex items-end justify-between gap-4">
      <div>
        <span
          className={cn(
            "font-mono text-[0.58rem] tracking-widest text-foreground-faint uppercase",
            inverse && "text-background/60",
          )}
        >
          {number} / {formatFamilyLabel(movement.family_key)}
        </span>

        <h3
          className={cn(
            "mt-2 text-2xl font-medium tracking-[-0.045em] text-foreground sm:text-3xl",
            inverse && "text-background",
          )}
        >
          {movement.name}
        </h3>
      </div>

      <span
        className={cn(
          "grid size-10 place-items-center rounded-full border border-border text-foreground-soft transition-transform duration-300 group-hover:-translate-y-1 group-hover:translate-x-1",
          inverse && "border-background/20 text-background",
        )}
        aria-hidden="true"
      >
        <ArrowUpRight className="size-4" />
      </span>
    </div>
  );
}

export async function ExerciseShowcase() {
  const movements = await publicApiFetchOr<MovementListItem[], MovementListItem[]>("/movements", []);

  const featuredMovements = featuredSlugs
    .map((slug) => movements.find((movement) => movement.slug === slug))
    .filter((movement): movement is MovementListItem => Boolean(movement));

  const [pullUp, frontLever, pushUp, chinUp, dips, backLever] =
    featuredMovements;

  if (!pullUp || !frontLever || !pushUp) {
    return null;
  }

  const supportingMovements = [chinUp, dips, backLever].filter(
    (movement): movement is MovementListItem => Boolean(movement),
  );

  return (
    <section
      id="movements"
      className="scroll-mt-20 bg-background-alt"
      aria-labelledby="movements-title"
    >
      <div className="mx-auto w-full max-w-360 px-4 py-24 sm:px-5 sm:py-32 lg:py-40">
        <div className="grid gap-8 lg:grid-cols-[1fr_0.7fr] lg:items-end lg:gap-20">
          <div>
            <Badge variant="outline">Movement library</Badge>

            <h2
              id="movements-title"
              className="mt-6 max-w-3xl text-[clamp(3rem,6vw,6rem)] leading-[0.92] font-medium tracking-[-0.065em] text-foreground"
            >
              Built around the way calisthenics moves.
            </h2>
          </div>

          <div className="max-w-lg lg:justify-self-end">
            <p className="text-base leading-7 text-foreground-soft">
              Each movement has its own positions, prerequisites, and safety
              guidance—so you can understand what makes each one distinct.
            </p>

            <Link
              className="mt-6 inline-flex items-center gap-2 text-sm font-medium text-foreground underline decoration-border underline-offset-8 transition-colors hover:text-primary hover:decoration-primary"
              href="/movements"
            >
              Explore the full library
              <ArrowUpRight className="size-3.5" aria-hidden="true" />
            </Link>
          </div>
        </div>

        <div className="mt-16 grid gap-4 sm:mt-24 lg:grid-cols-12 lg:grid-rows-2">
          <Link
            href={`/movements/${pullUp.slug}`}
            className="group relative min-h-140 overflow-hidden rounded-[2px_2px_36px_2px] border border-border bg-card p-5 sm:min-h-170 sm:p-7 lg:col-span-7 lg:row-span-2"
            aria-label={`View ${pullUp.name} guide`}
          >
            <div
              className="absolute inset-0 cv-grid opacity-25"
              aria-hidden="true"
            />

            <div
              className="absolute top-[16%] left-[18%] aspect-square w-[64%] rounded-full bg-primary-light"
              aria-hidden="true"
            />

            {pullUp.illustration_url && (
              <div className="absolute inset-[7%_-4%_13%] transition-transform duration-700 ease-out group-hover:scale-[1.025]">
                <Image
                  className="object-contain drop-shadow-[0_24px_30px_rgba(28,28,26,0.12)]"
                  src={pullUp.illustration_url}
                  alt={`${pullUp.name} movement illustration`}
                  fill
                  sizes="(max-width: 1024px) 100vw, 58vw"
                />
              </div>
            )}

            <div className="absolute right-5 bottom-5 left-5 sm:right-7 sm:bottom-7 sm:left-7">
              <ExerciseMeta number="01" movement={pullUp} />
            </div>
          </Link>

          <Link
            href={`/movements/${frontLever.slug}`}
            className="group relative min-h-82.5 overflow-hidden rounded-[2px_28px_2px_2px] border border-border bg-primary p-5 sm:p-7 lg:col-span-5"
            aria-label={`View ${frontLever.name} guide`}
          >
            {frontLever.illustration_url && (
              <div className="absolute inset-[-4%_-6%_12%] transition-transform duration-700 ease-out group-hover:translate-x-2">
                <Image
                  className="object-contain drop-shadow-[0_20px_25px_rgba(28,28,26,0.16)]"
                  src={frontLever.illustration_url}
                  alt={`${frontLever.name} movement illustration`}
                  fill
                  sizes="(max-width: 1024px) 100vw, 42vw"
                />
              </div>
            )}

            <div className="absolute right-5 bottom-5 left-5 sm:right-7 sm:bottom-7 sm:left-7">
              <ExerciseMeta number="02" movement={frontLever} inverse />
            </div>
          </Link>

          <Link
            href={`/movements/${pushUp.slug}`}
            className="group relative min-h-82.5 overflow-hidden rounded-[2px_2px_28px_2px] border border-border bg-background p-5 sm:p-7 lg:col-span-5"
            aria-label={`View ${pushUp.name} guide`}
          >
            {pushUp.illustration_url && (
              <div className="absolute inset-[-7%_-2%_12%] transition-transform duration-700 ease-out group-hover:translate-x-2">
                <Image
                  className="object-contain drop-shadow-[0_20px_25px_rgba(28,28,26,0.12)]"
                  src={pushUp.illustration_url}
                  alt={`${pushUp.name} movement illustration`}
                  fill
                  sizes="(max-width: 1024px) 100vw, 42vw"
                />
              </div>
            )}

            <div className="absolute right-5 bottom-5 left-5 sm:right-7 sm:bottom-7 sm:left-7">
              <ExerciseMeta number="03" movement={pushUp} />
            </div>
          </Link>
        </div>

        {supportingMovements.length > 0 && (
          <div className="mt-4 grid gap-4 md:grid-cols-3">
            {supportingMovements.map((movement, index) => (
              <Link
                href={`/movements/${movement.slug}`}
                className="group relative min-h-90 overflow-hidden border border-border bg-card p-5 sm:p-6"
                key={movement.slug}
                aria-label={`View ${movement.name} guide`}
              >
                {movement.illustration_url && (
                  <div className="absolute inset-[4%_-4%_19%] transition-transform duration-700 ease-out group-hover:scale-[1.035]">
                    <Image
                      className="object-contain drop-shadow-[0_18px_22px_rgba(28,28,26,0.1)]"
                      src={movement.illustration_url}
                      alt={`${movement.name} movement illustration`}
                      fill
                      sizes="(max-width: 768px) 100vw, 33vw"
                    />
                  </div>
                )}

                <div className="absolute right-5 bottom-5 left-5 sm:right-6 sm:bottom-6 sm:left-6">
                  <ExerciseMeta
                    number={String(index + 4).padStart(2, "0")}
                    movement={movement}
                  />
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
