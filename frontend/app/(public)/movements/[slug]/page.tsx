import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { Footer } from "@/components/shared/footer";
import { Navbar } from "@/components/shared/navbar";
import { ApiError } from "@/lib/api";

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

export const dynamic = "force-dynamic";

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
          ? [{ url: movement.illustration_url, alt: `${movement.name} illustration` }]
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
    <main id="top" className="min-h-dvh overflow-x-hidden bg-background">
      <Navbar activePage="movements" />

      <article>
        <MovementHero movement={movement} />
        <SafetyOverview content={content} />
        <ReadinessSection content={content} />
        <CautionsSection content={content} />
        <StopConditionsSection content={content} />
        <MovementCapabilities movement={movement} />
      </article>

      <Footer />
    </main>
  );
}
