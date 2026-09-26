import {
  ExerciseCard,
  MovementListItem,
} from "@/components/exercises/exercise-card";
import { Skeleton } from "@/components/ui/skeleton";
import { publicApiFetchOr } from "@/lib/public-api";
import { BookOpen, ScanLine } from "lucide-react";

async function MovementsCatalog() {
  const movements = await publicApiFetchOr<MovementListItem[], MovementListItem[]>("/movements", []);

  if (movements.length === 0) {
    return (
      <section className="border-b border-border bg-background-alt">
        <div className="mx-auto flex min-h-96 w-full max-w-360 items-center justify-center px-4 py-20 sm:px-5">
          <div className="max-w-md text-center">
            <BookOpen
              className="mx-auto size-6 text-primary"
              aria-hidden="true"
            />

            <h2 className="mt-5 text-2xl font-medium tracking-tight text-foreground">
              No movement guides yet
            </h2>

            <p className="mt-3 text-sm leading-6 text-foreground-soft">
              Published movement guides will appear here when they become
              available.
            </p>
          </div>
        </div>
      </section>
    );
  }

  const families = groupMovementsByFamily(movements);

  return (
    <div className="bg-background-alt">
      <div className="border-b border-border bg-background">
        <div className="mx-auto flex w-full max-w-360 items-center gap-3 px-4 py-5 font-mono text-[0.58rem] font-semibold tracking-widest text-foreground-faint uppercase sm:px-5">
          <ScanLine className="size-3.5 text-primary" aria-hidden="true" />
          {movements.length}{" "}
          {movements.length === 1
            ? "published movement"
            : "published movements"}
        </div>
      </div>

      {families.map((family, familyIndex) => (
        <section
          key={family.key}
          aria-labelledby={`${family.key}-title`}
          className="border-b border-border last:border-b-0"
        >
          <div className="mx-auto w-full max-w-360 px-4 py-20 sm:px-5 sm:py-24 lg:py-28">
            <div className="grid gap-5 md:grid-cols-[minmax(0,0.7fr)_minmax(280px,0.3fr)] md:items-end md:gap-12">
              <div>
                <span className="font-mono text-[0.58rem] font-semibold tracking-[0.11em] text-primary uppercase">
                  {String(familyIndex + 1).padStart(2, "0")} /{" "}
                  {family.movements.length}{" "}
                  {family.movements.length === 1 ? "movement" : "movements"}
                </span>

                <h2
                  id={`${family.key}-title`}
                  className="mt-3 text-[clamp(2.5rem,5vw,4.8rem)] leading-[0.92] font-medium tracking-[-0.06em] text-foreground"
                >
                  {family.label}
                </h2>
              </div>

              <p className="max-w-lg text-sm leading-6 text-foreground-soft md:justify-self-end">
                {family.movements.length === 1
                  ? `1 published guide in the ${family.label.toLowerCase()} family.`
                  : `${family.movements.length} published guides in the ${family.label.toLowerCase()} family.`}
              </p>
            </div>

            <div className="mt-10 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
              {family.movements.map((movement, movementIndex) => (
                <ExerciseCard
                  key={movement.slug}
                  exercise={movement}
                  eager={familyIndex === 0 && movementIndex < 3}
                />
              ))}
            </div>
          </div>
        </section>
      ))}
    </div>
  );
}

function MovementsCatalogSkeleton() {
  return (
    <div className="bg-background-alt" aria-hidden="true">
      <div className="border-b border-border bg-background">
        <div className="mx-auto w-full max-w-360 px-4 py-5 sm:px-5">
          <Skeleton className="h-3 w-40" />
        </div>
      </div>

      {Array.from({ length: 2 }).map((_, sectionIndex) => (
        <section key={sectionIndex} className="border-b border-border">
          <div className="mx-auto w-full max-w-360 px-4 py-20 sm:px-5 sm:py-24 lg:py-28">
            <div className="grid gap-5 md:grid-cols-[minmax(0,0.7fr)_minmax(280px,0.3fr)] md:items-end md:gap-12">
              <div>
                <Skeleton className="h-3 w-28" />

                <Skeleton className="mt-4 h-12 w-56 sm:h-16 sm:w-72" />
              </div>

              <div className="space-y-2 md:justify-self-end">
                <Skeleton className="h-3 w-64" />
                <Skeleton className="h-3 w-48" />
              </div>
            </div>

            <div className="mt-10 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
              {Array.from({ length: 3 }).map((_, cardIndex) => (
                <div
                  key={cardIndex}
                  className="overflow-hidden rounded-[3px_3px_30px_3px] border border-border bg-card"
                >
                  <Skeleton className="aspect-4/3 w-full rounded-none" />

                  <div className="p-5 sm:p-6">
                    <Skeleton className="h-2.5 w-24" />

                    <Skeleton className="mt-4 h-9 w-40" />

                    <div className="mt-5 flex items-center justify-between border-t border-border pt-4">
                      <Skeleton className="h-3 w-20" />
                      <Skeleton className="h-3 w-28" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      ))}
    </div>
  );
}


export { MovementsCatalog, MovementsCatalogSkeleton };

type MovementFamily = {
  key: string;
  label: string;
  movements: MovementListItem[];
};

function formatFamilyLabel(familyKey: string) {
  return familyKey
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function groupMovementsByFamily(
  movements: MovementListItem[],
): MovementFamily[] {
  const families = new Map<string, MovementListItem[]>();

  for (const movement of movements) {
    const existing = families.get(movement.family_key);

    if (existing) {
      existing.push(movement);
      continue;
    }

    families.set(movement.family_key, [movement]);
  }

  return Array.from(families.entries())
    .map(([key, familyMovements]) => ({
      key,
      label: formatFamilyLabel(key),
      movements: familyMovements.sort((a, b) => a.name.localeCompare(b.name)),
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}
