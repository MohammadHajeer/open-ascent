import Image from "next/image";
import { ArrowDownRight } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { publicApiFetchOr } from "@/lib/public-api";

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

const capabilities = [
  {
    number: "01",
    title: "Exercise-aware detection",
    description:
      "Movement analysis is designed around the exercise being performed instead of treating every motion the same.",
  },
  {
    number: "02",
    title: "Valid rep recognition",
    description:
      "Completed repetitions can be distinguished from partial or unrelated changes in position.",
  },
  {
    number: "03",
    title: "Movement-phase understanding",
    description:
      "Different stages of a movement can be interpreted as distinct phases rather than one continuous motion.",
  },
  {
    number: "04",
    title: "Technique signals",
    description:
      "Supported measurements can include range of motion, joint position, body alignment, and tempo.",
  },
  {
    number: "05",
    title: "Calisthenics by design",
    description:
      "The movement model is built around bodyweight exercises, static holds, variations, and progressions.",
  },
];

function formatFamilyLabel(familyKey: string) {
  return familyKey
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export async function Difference() {
  const movement = await publicApiFetchOr<MovementGuide, null>(
    "/movements/inverted-deadlift",
    null,
  );

  if (!movement) return null;

  return (
    <section className="bg-background" aria-labelledby="difference-title">
      <div className="mx-auto w-full max-w-360 px-4 py-24 sm:px-5 sm:py-32 lg:py-40">
        <div className="grid gap-14 lg:grid-cols-[0.82fr_1.18fr] lg:gap-20">
          <div>
            <Badge variant="secondary">Why it is different</Badge>

            <h2
              id="difference-title"
              className="mt-6 max-w-2xl text-[clamp(3rem,5.5vw,5.8rem)] leading-[0.93] font-medium tracking-[-0.065em] text-foreground"
            >
              Specific enough to be useful.
            </h2>

            <p className="mt-6 max-w-md text-base leading-7 text-foreground-soft">
              Useful coaching depends on movement context. A front lever and a
              pull-up may share a bar, but they demand completely different
              positions, phases, and technique.
            </p>

            <div className="relative mt-12 min-h-110 overflow-hidden rounded-[2px_2px_36px_2px] border border-border bg-background-alt sm:min-h-140 lg:mt-20">
              <div
                className="cv-grid absolute inset-0 opacity-30"
                aria-hidden="true"
              />

              {movement.illustration_url ? (
                <div className="absolute inset-[7%_-8%_4%]">
                  <Image
                    className="object-contain drop-shadow-[0_22px_28px_rgba(28,28,26,0.12)]"
                    src={movement.illustration_url}
                    alt={`${movement.name} movement illustration`}
                    fill
                    sizes="(max-width: 1024px) 100vw, 42vw"
                  />
                </div>
              ) : (
                <div className="absolute inset-0 grid place-items-center">
                  <span className="font-mono text-[0.58rem] tracking-widest text-foreground-faint uppercase">
                    Illustration unavailable
                  </span>
                </div>
              )}

              <span className="absolute bottom-5 left-5 rounded-full border border-border bg-card/90 px-3 py-2 font-mono text-[0.57rem] tracking-[0.09em] text-foreground-mid uppercase backdrop-blur-xl sm:bottom-7 sm:left-7">
                {movement.name}
                {" / "}
                {formatFamilyLabel(movement.family_key)}
              </span>

              <span className="absolute right-5 bottom-5 rounded-full border border-border bg-card/90 px-3 py-2 font-mono text-[0.57rem] tracking-[0.09em] text-primary uppercase backdrop-blur-xl sm:right-7 sm:bottom-7">
                {movement.documentation.content.difficulty}
              </span>
            </div>
          </div>

          <ol className="border-t border-border lg:mt-2">
            {capabilities.map((capability) => (
              <li
                className="group grid grid-cols-[42px_1fr_auto] gap-4 border-b border-border py-7 sm:grid-cols-[64px_1fr_auto] sm:gap-6 sm:py-9"
                key={capability.number}
              >
                <span className="pt-1 font-mono text-[0.6rem] tracking-widest text-primary">
                  {capability.number}
                </span>

                <div>
                  <h3 className="text-xl font-medium tracking-[-0.04em] text-foreground sm:text-2xl">
                    {capability.title}
                  </h3>

                  <p className="mt-2 max-w-xl text-sm leading-6 text-foreground-soft">
                    {capability.description}
                  </p>
                </div>

                <ArrowDownRight className="mt-1 size-4 text-foreground-faint transition-transform duration-300 group-hover:translate-x-1 group-hover:translate-y-1 group-hover:text-primary" />
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}
