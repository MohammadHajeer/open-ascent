import Image from "next/image";
import Link from "next/link";

import {
  getAnalysisGuestConfig,
  getAnalysisMovementGuide,
  getAnalysisMovements,
} from "@/lib/analysis-public";
import type { Movement } from "@/lib/analysis";
import { AnalyzeSteps } from "./analyze-steps";
import { GuestAnalysisClient } from "./guest-analysis-client";
import { SafetyGuidance } from "./safety-guidance";

function SectionNotice({ title, detail }: { title: string; detail: string }) {
  return (
    <>
      <AnalyzeSteps activeIndex={0} />
      <div className="pt-12 sm:pt-16">
        <section className="rounded-[3px_3px_34px_3px] border border-border bg-card p-6 sm:p-9">
          <h2 className="text-3xl font-medium tracking-tighter text-foreground">{title}</h2>
          <p className="mt-4 text-sm leading-6 text-foreground-soft">{detail}</p>
          <Link href="/analyze" className="mt-6 inline-block text-sm font-medium text-primary underline-offset-4 hover:underline">View available movements</Link>
        </section>
      </div>
    </>
  );
}

function MovementSelector({ movements }: { movements: Movement[] }) {
  return (
    <>
      <AnalyzeSteps activeIndex={0} />
      <div className="pt-12 sm:pt-16">
        <section aria-labelledby="exercise-selector-title">
          <span className="font-mono text-[0.59rem] font-semibold tracking-widest text-primary uppercase">Step 01 / Exercise</span>
          <h2 id="exercise-selector-title" className="mt-3 text-[clamp(2rem,4vw,3.6rem)] leading-none font-medium tracking-[-0.055em] text-foreground">What are you performing?</h2>
          <p className="mt-4 max-w-xl text-sm leading-6 text-foreground-soft">Only movements with an available analyzer can be selected.</p>
          {movements.length ? <div className="mt-8 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
            {movements.map((movement) => (
              <Link key={movement.id} href={`/analyze?movement=${encodeURIComponent(movement.slug)}`} prefetch={false} className="group overflow-hidden rounded-[3px_3px_24px_3px] border border-border bg-card text-left transition hover:-translate-y-0.5 hover:border-primary focus-visible:ring-2 focus-visible:ring-ring">
                <span className="relative block aspect-4/3 border-b border-border bg-background-alt">
                  {movement.illustration_url ? <Image src={movement.illustration_url} alt="" fill sizes="(max-width: 640px) 46vw, 22vw" className="object-contain p-3" /> : <span className="grid size-full place-items-center text-xs text-foreground-faint">Illustration unavailable</span>}
                </span>
                <span className="block px-5 py-4"><strong className="block text-sm text-foreground">{movement.name}</strong><span className="mt-1 block text-xs text-foreground-soft">{movement.family_key.split("_").map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" ")}</span></span>
              </Link>
            ))}
          </div> : <p className="mt-8 text-sm text-foreground-soft">No movements are currently available for video analysis.</p>}
        </section>
      </div>
    </>
  );
}

export async function AnalyzeMovementSection({
  selectedSlug,
  invalidSelection,
}: {
  selectedSlug: string | null;
  invalidSelection: boolean;
}) {
  const [movementsState, configState, guideState] = await Promise.allSettled([
    getAnalysisMovements(),
    getAnalysisGuestConfig(),
    selectedSlug ? getAnalysisMovementGuide(selectedSlug) : Promise.resolve(null),
  ]);

  if (movementsState.status === "rejected" || configState.status === "rejected") {
    return <SectionNotice title="Analysis options are unavailable." detail="The movement list or upload requirements could not be loaded. Please try again shortly." />;
  }

  const available = movementsState.value.filter((movement) => movement.upload_analysis_supported);
  if (invalidSelection) {
    return <SectionNotice title="Movement unavailable." detail="Choose an available movement to start an analysis." />;
  }
  if (!selectedSlug) return <MovementSelector movements={available} />;

  const selected = available.find((movement) => movement.slug === selectedSlug);
  if (!selected) {
    return <SectionNotice title="Movement unavailable." detail="This movement is not currently available for video analysis." />;
  }

  if (guideState.status === "rejected" || !guideState.value || guideState.value.id !== selected.id || !guideState.value.upload_analysis_supported) {
    return <SectionNotice title="Movement guide unavailable." detail="The published movement guidance could not be loaded. Analysis cannot start without it." />;
  }

  const guide = guideState.value;
  const config = configState.value;
  return (
    <GuestAnalysisClient
      key={guide.slug}
      movement={{
        id: guide.id,
        name: guide.name,
        illustrationUrl: guide.illustration_url,
        safetyDocumentationId: guide.documentation.id,
      }}
      config={{
        maxSizeBytes: config.max_size_bytes,
        maxDurationSeconds: config.max_duration_seconds,
        safetyAckVersion: config.safety_ack_version,
      }}
      safetyGuidance={<SafetyGuidance safety={guide.documentation.content} movementName={guide.name} />}
    />
  );
}
