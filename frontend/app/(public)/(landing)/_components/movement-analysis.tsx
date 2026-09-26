import Image from "next/image";
import { Check, ScanLine } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { publicApiFetchOr } from "@/lib/public-api";
import { Skeleton } from "@/components/ui/skeleton";

type MovementGuide = {
  id: string;
  slug: string;
  name: string;
  family_key: string;
  illustration_url: string | null;
  upload_analysis_supported: boolean;
  live_coach_supported: boolean;
  documentation: {
    id: string;
    movement_id: string;
    version: number;
    status: "published";
    content: {
      notice: string;
      difficulty: "beginner" | "intermediate" | "advanced";
      stressed_areas: string[];
      prerequisites: string[];
      cautions: string[];
      stop_conditions: string[];
      easier_option: string | null;
      setup: string[] | null;
    };
  };
};

const metrics = [
  {
    label: "Full extension",
    value: "Detected",
    status: true,
  },
  {
    label: "Range of motion",
    value: "Complete",
    status: true,
  },
  {
    label: "Movement phase",
    value: "Pulling",
    status: false,
  },
];

function formatFamilyLabel(familyKey: string) {
  return familyKey
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export async function MovementAnalysis() {
  const movement = await publicApiFetchOr<MovementGuide, null>("/movements/pull-up", null);

  if (!movement) return null;

  return (
    <section
      id="analysis"
      className="scroll-mt-20 bg-background"
      aria-labelledby="analysis-title"
    >
      <div className="mx-auto w-full max-w-360 px-4 py-24 sm:px-5 sm:py-32 lg:py-40">
        <div className="grid gap-9 lg:grid-cols-[0.76fr_1.24fr] lg:items-end lg:gap-20">
          <div>
            <Badge variant="outline">
              <ScanLine aria-hidden="true" />
              Movement intelligence
            </Badge>

            <p className="mt-5 max-w-md text-sm leading-6 text-foreground-soft">
              {movement.documentation.content.notice}
            </p>
          </div>

          <h2
            id="analysis-title"
            className="max-w-4xl text-[clamp(3rem,6vw,6.2rem)] leading-[0.92] font-medium tracking-[-0.065em] text-foreground"
          >
            The coach actually sees how you move.
          </h2>
        </div>

        <div className="mt-16 overflow-hidden rounded-[3px_3px_40px_3px] border border-border bg-card sm:mt-24">
          <div className="flex min-h-16 items-center justify-between border-b border-border px-5 sm:px-7">
            <div className="flex items-center gap-3">
              <span className="relative flex size-2">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-primary opacity-40 motion-reduce:animate-none" />

                <span className="relative inline-flex size-2 rounded-full bg-primary" />
              </span>

              <span className="font-mono text-[0.6rem] font-semibold tracking-widest text-foreground-mid uppercase">
                Illustrative analysis
              </span>
            </div>

            <div className="flex items-center gap-4 font-mono text-[0.58rem] tracking-[0.08em] text-foreground-faint uppercase sm:gap-7">
              <span className="hidden sm:inline">Recorded video</span>

              <span>00:37</span>
            </div>
          </div>

          <div className="grid lg:grid-cols-[1fr_330px] xl:grid-cols-[1fr_380px]">
            <div className="relative min-h-140 overflow-hidden border-border bg-background-alt lg:border-r">
              <div
                className="cv-grid absolute inset-0 opacity-35"
                aria-hidden="true"
              />

              <span className="absolute top-5 left-5 z-10 rounded-full border border-border bg-card/90 px-3 py-2 font-mono text-[0.58rem] tracking-widest text-primary uppercase backdrop-blur-xl sm:top-7 sm:left-7">
                {movement.name} / pulling phase
              </span>

              {movement.illustration_url ? (
                <div className="absolute inset-[8%_-8%_5%] transition-transform duration-700 hover:scale-[1.02] sm:inset-[3%_4%_3%]">
                  <Image
                    className="object-contain drop-shadow-[0_24px_32px_rgba(28,28,26,0.14)]"
                    src={movement.illustration_url}
                    alt={`${movement.name} movement illustration`}
                    fill
                    sizes="(max-width: 1024px) 100vw, 70vw"
                  />

                  <div
                    className="pointer-events-none absolute inset-0"
                    aria-hidden="true"
                  >
                    <span className="absolute top-[31%] left-[42%] size-2.5 rounded-full border-2 border-background bg-primary" />
                    <span className="absolute top-[31%] right-[41%] size-2.5 rounded-full border-2 border-background bg-primary" />
                    <span className="absolute top-[45%] left-[37%] size-2.5 rounded-full border-2 border-background bg-primary" />
                    <span className="absolute top-[45%] right-[36%] size-2.5 rounded-full border-2 border-background bg-primary" />
                    <span className="absolute top-[52%] left-1/2 size-2.5 -translate-x-1/2 rounded-full border-2 border-background bg-primary" />
                  </div>
                </div>
              ) : (
                <div className="absolute inset-0 grid place-items-center">
                  <span className="font-mono text-[0.58rem] tracking-widest text-foreground-faint uppercase">
                    Illustration unavailable
                  </span>
                </div>
              )}

              <div className="absolute bottom-5 left-5 z-10 grid min-w-31 rounded-2xl border border-border bg-card/90 p-4 shadow-lg backdrop-blur-xl sm:bottom-7 sm:left-7">
                <span className="font-mono text-[0.55rem] tracking-widest text-foreground-faint uppercase">
                  Current rep
                </span>

                <strong className="mt-1 text-4xl font-medium tracking-[-0.06em] text-foreground">
                  04
                </strong>
              </div>
            </div>

            <aside
              className="flex flex-col p-5 sm:p-7"
              aria-label="Illustrative analysis metrics"
            >
              <div>
                <span className="font-mono text-[0.58rem] tracking-widest text-foreground-faint uppercase">
                  Movement
                </span>

                <div className="mt-3 text-3xl font-medium tracking-tighter text-foreground">
                  {movement.name}
                </div>

                <p className="mt-2 font-mono text-[0.56rem] tracking-widest text-foreground-faint uppercase">
                  {formatFamilyLabel(movement.family_key)}
                  {" · "}
                  {movement.documentation.content.difficulty}
                </p>
              </div>

              <div className="mt-9 grid border-t border-border">
                {metrics.map((metric) => (
                  <div
                    className="grid grid-cols-[1fr_auto] gap-4 border-b border-border py-5"
                    key={metric.label}
                  >
                    <span className="text-xs text-foreground-faint">
                      {metric.label}
                    </span>

                    <strong className="text-right text-xs font-medium text-foreground">
                      {metric.status && (
                        <Check
                          className="mr-1 inline size-3.5 text-primary"
                          aria-hidden="true"
                        />
                      )}

                      {metric.value}
                    </strong>
                  </div>
                ))}
              </div>

              <div className="mt-8">
                <div className="flex items-end justify-between">
                  <span className="text-xs text-foreground-faint">
                    Elbow angle
                  </span>

                  <strong className="text-2xl font-medium tracking-tighter">
                    78°
                  </strong>
                </div>

                <div className="mt-3 h-1 overflow-hidden rounded-full bg-muted">
                  <div className="h-full w-[78%] rounded-full bg-primary" />
                </div>

                <p className="mt-4 text-xs leading-5 text-foreground-soft">
                  Controlled flexion through the pulling phase.
                </p>
              </div>

              <div className="mt-auto pt-10">
                <div className="rounded-2xl bg-primary-light p-4">
                  <span className="font-mono text-[0.55rem] tracking-widest text-primary uppercase">
                    Coach note
                  </span>

                  <p className="mt-2 text-sm leading-5 text-foreground-mid">
                    Full extension reached. Keep control through the return.
                  </p>
                </div>
              </div>
            </aside>
          </div>
        </div>
      </div>
    </section>
  );
}

export function MovementAnalysisSkeleton() {
  return (
    <section className="bg-background" aria-hidden="true">
      <div className="mx-auto w-full max-w-360 px-4 py-24 sm:px-5 sm:py-32 lg:py-40">
        <div className="grid gap-9 lg:grid-cols-[0.76fr_1.24fr] lg:items-end lg:gap-20">
          <div>
            <Skeleton className="h-6 w-44 rounded-full" />

            <div className="mt-5 space-y-2">
              <Skeleton className="h-4 w-full max-w-sm" />
              <Skeleton className="h-4 w-10/12 max-w-sm" />
              <Skeleton className="h-4 w-8/12 max-w-xs" />
            </div>
          </div>

          <div className="space-y-3">
            <Skeleton className="h-14 w-full max-w-3xl sm:h-16" />
            <Skeleton className="h-14 w-4/5 max-w-2xl sm:h-16" />
          </div>
        </div>

        <div className="mt-16 overflow-hidden rounded-[3px_3px_40px_3px] border border-border bg-card sm:mt-24">
          <div className="flex min-h-16 items-center justify-between border-b border-border px-5 sm:px-7">
            <div className="flex items-center gap-3">
              <Skeleton className="size-2 rounded-full" />
              <Skeleton className="h-3 w-32" />
            </div>

            <div className="flex items-center gap-4 sm:gap-7">
              <Skeleton className="hidden h-3 w-24 sm:block" />
              <Skeleton className="h-3 w-10" />
            </div>
          </div>

          <div className="grid lg:grid-cols-[1fr_330px] xl:grid-cols-[1fr_380px]">
            <div className="relative min-h-140 overflow-hidden border-border bg-background-alt lg:border-r">
              <Skeleton className="absolute top-5 left-5 z-10 h-8 w-44 rounded-full sm:top-7 sm:left-7" />

              <div className="absolute inset-[8%_6%_8%]">
                <Skeleton className="size-full rounded-2xl" />
              </div>

              <div className="absolute bottom-5 left-5 z-10 grid min-w-31 gap-2 rounded-2xl border border-border bg-card/90 p-4 sm:bottom-7 sm:left-7">
                <Skeleton className="h-2.5 w-20" />
                <Skeleton className="h-10 w-14" />
              </div>
            </div>

            <aside className="flex flex-col p-5 sm:p-7">
              <div>
                <Skeleton className="h-3 w-20" />
                <Skeleton className="mt-3 h-9 w-32" />
                <Skeleton className="mt-3 h-3 w-40" />
              </div>

              <div className="mt-9 grid border-t border-border">
                {Array.from({ length: 3 }).map((_, index) => (
                  <div
                    key={index}
                    className="grid grid-cols-[1fr_auto] gap-4 border-b border-border py-5"
                  >
                    <Skeleton className="h-3 w-24" />
                    <Skeleton className="h-3 w-20" />
                  </div>
                ))}
              </div>

              <div className="mt-8">
                <div className="flex items-end justify-between">
                  <Skeleton className="h-3 w-20" />
                  <Skeleton className="h-7 w-12" />
                </div>

                <Skeleton className="mt-3 h-1 w-full rounded-full" />

                <div className="mt-4 space-y-2">
                  <Skeleton className="h-3 w-full" />
                  <Skeleton className="h-3 w-3/4" />
                </div>
              </div>

              <div className="mt-auto pt-10">
                <div className="rounded-2xl bg-primary-light p-4">
                  <Skeleton className="h-2.5 w-20" />

                  <div className="mt-3 space-y-2">
                    <Skeleton className="h-3 w-full" />
                    <Skeleton className="h-3 w-4/5" />
                  </div>
                </div>
              </div>
            </aside>
          </div>
        </div>
      </div>
    </section>
  );
}
