import { Suspense } from "react";
import { ShieldCheck } from "lucide-react";

import { AnalyzeMovementSection } from "@/components/analyze/analyze-movement-section";
import { AnalyzeSectionSkeleton } from "@/components/analyze/analyze-section-skeleton";
import { Badge } from "@/components/ui/badge";

type AnalyzePageProps = {
  searchParams: Promise<{ movement?: string | string[] }>;
};

export default async function AnalyzePage({ searchParams }: AnalyzePageProps) {
  const query = (await searchParams).movement;
  const selectedSlug = typeof query === "string" && query.trim() ? query : null;
  const invalidSelection = query !== undefined && selectedSlug === null;

  return (
    <div className="mx-auto w-full max-w-360 px-4 pb-24 sm:px-5 sm:pb-32">
      <header className="grid gap-7 border-b border-border py-12 sm:py-16 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end lg:py-20">
        <div>
          <Badge variant="outline"><ShieldCheck aria-hidden="true" /> Guest analysis</Badge>
          <h1 className="mt-5 text-[clamp(3.2rem,8vw,7.2rem)] leading-[0.88] font-medium tracking-[-0.072em] text-foreground">Analyze your movement.</h1>
          <p className="mt-6 max-w-2xl text-base leading-7 text-foreground-soft sm:text-lg sm:leading-8">Upload a short movement video for deterministic rep counts and evidence findings.</p>
        </div>
        <p className="max-w-xs text-xs leading-6 text-foreground-soft">Your video is uploaded to private storage for analysis. Guest access expires after a limited time.</p>
      </header>
      <Suspense
        key={selectedSlug ?? (invalidSelection ? "invalid" : "index")}
        fallback={<AnalyzeSectionSkeleton selected={query !== undefined} />}
      >
        <AnalyzeMovementSection selectedSlug={selectedSlug} invalidSelection={invalidSelection} />
      </Suspense>
    </div>
  );
}
