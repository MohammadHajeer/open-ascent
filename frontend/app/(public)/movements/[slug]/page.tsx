import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ApiError, apiFetch } from "@/lib/api";

import { CautionsSection } from "./_components/cautions-section";
import { MovementCapabilities } from "./_components/movement-capabilities";
import { MovementHero } from "./_components/movement-hero";
import { ReadinessSection } from "./_components/readiness-section";
import { SafetyOverview } from "./_components/safety-overview";
import { StopConditionsSection } from "./_components/stop-conditions-section";
import { getMovementGuide } from "./_lib/get-movement";

type MovementPageProps = {
  params: Promise<{ slug: string }>;
};

// Published guides are prerendered at build time and revalidated in the
// background. A guide published after the build, or every guide when the API
// is unreachable during the build, renders on its first visit instead.
export async function generateStaticParams() {
  try {
    const movements = await apiFetch<{ slug: string }[]>("/movements", {
      cache: "no-store",
    });
    return movements.map(({ slug }) => ({ slug }));
  } catch {
    return [];
  }
}

export async function generateMetadata({
  params,
}: MovementPageProps): Promise<Metadata> {
  const { slug } = await params;

  try {
    const movement = await getMovementGuide(slug);
    const title = `${movement.name} Movement Guide — Open Ascent`;
    const description = `Read ${movement.name} safety guidance, prerequisites, setup information, cautions, and stop conditions on Open Ascent.`;

    return {
      title,
      description,
      openGraph: {
        title,
        description,
        type: "article",
        images: movement.illustration_url
          ? [
              {
                url: movement.illustration_url,
                alt: `${movement.name} illustration`,
              },
            ]
          : [],
      },
      twitter: {
        card: movement.illustration_url ? "summary_large_image" : "summary",
        title,
        description,
        images: movement.illustration_url ? [movement.illustration_url] : [],
      },
    };
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      return {
        title: "Movement not found — Open Ascent",
        description: "The requested movement guide could not be found.",
      };
    }

    throw error;
  }
}

export default async function MovementPage({ params }: MovementPageProps) {
  const { slug } = await params;

  let movement;

  try {
    movement = await getMovementGuide(slug);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      notFound();
    }

    throw error;
  }

  const { content } = movement.documentation;

  return (
    <article>
      <MovementHero movement={movement} />
      <SafetyOverview content={content} />
      <ReadinessSection content={content} />
      <CautionsSection content={content} />
      <StopConditionsSection content={content} />
      <MovementCapabilities movement={movement} />
    </article>
  );
}
