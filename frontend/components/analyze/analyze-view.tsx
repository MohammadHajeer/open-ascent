"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ShieldCheck } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { GuestAnalysisTour } from "@/components/tour/guest-analysis-tour";
import { ActiveWorkoutIndicator } from "@/features/workouts/active-workout-indicator";
import { useSessionState, type SessionState } from "@/lib/supabase/use-session-state";

import { AnalyzeMovementSection } from "./analyze-movement-section";
import { AnalyzeSectionSkeleton } from "./analyze-section-skeleton";

function AnalyzeHeader({ session }: { session: SessionState }) {
  const authenticated = session === "authenticated";

  return (
    <header className="grid gap-7 border-b border-border py-12 sm:py-16 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end lg:py-20">
      <div>
        {session === "loading" ? (
          <span aria-hidden="true" className="inline-block h-6 w-40 rounded-full bg-border/70" />
        ) : (
          <Badge variant="outline"><ShieldCheck aria-hidden="true" /> {authenticated ? "Private saved analysis" : "Guest analysis"}</Badge>
        )}
        <h1 className="mt-5 text-[clamp(3.2rem,8vw,7.2rem)] leading-[0.88] font-medium tracking-[-0.072em] text-foreground">Analyze your movement.</h1>
        <p className="mt-6 max-w-2xl text-base leading-7 text-foreground-soft sm:text-lg sm:leading-8">Upload or record a short movement video for deterministic rep counts and evidence findings.</p>
      </div>
      <p className="max-w-xs text-xs leading-6 text-foreground-soft">Your video is uploaded to private storage for analysis.{session === "loading" ? null : authenticated ? " The result is saved to your history; raw video is removed after processing." : " Guest access expires after a limited time."}</p>
    </header>
  );
}

// The analysis id is read once per selection. The upload flow writes it into
// the URL with history.replaceState, and that must not remount the flow.
function AnalyzeSelection({
  selectedSlug,
  invalidSelection,
  analysisId,
  authenticated,
}: {
  selectedSlug: string | null;
  invalidSelection: boolean;
  analysisId: string | null;
  authenticated: boolean;
}) {
  const [initialAnalysisId] = useState(analysisId);

  return (
    <AnalyzeMovementSection
      selectedSlug={selectedSlug}
      invalidSelection={invalidSelection}
      analysisId={initialAnalysisId}
      authenticated={authenticated}
    />
  );
}

function AnalyzeSelectionFromUrl({ session }: { session: SessionState }) {
  const params = useSearchParams();
  const movements = params.getAll("movement");
  const analyses = params.getAll("analysis");
  const query = movements.length > 1 ? movements : movements[0];
  const selectedSlug = typeof query === "string" && query.trim() ? query : null;
  const invalidSelection = query !== undefined && selectedSlug === null;
  const analysisId = analyses.length === 1 ? analyses[0] : null;

  if (session === "loading") {
    return <AnalyzeSectionSkeleton selected={query !== undefined} />;
  }

  const authenticated = session === "authenticated";
  const scope = selectedSlug ?? (invalidSelection ? "invalid" : "index");

  return (
    <AnalyzeSelection
      key={`${scope}:${session}`}
      selectedSlug={selectedSlug}
      invalidSelection={invalidSelection}
      analysisId={analysisId}
      authenticated={authenticated}
    />
  );
}

export function AnalyzeView() {
  const session = useSessionState();

  return (
    <>
      {session === "authenticated" ? <ActiveWorkoutIndicator surface="analyze" /> : null}
      <div className="mx-auto w-full max-w-360 px-4 pb-24 sm:px-5 sm:pb-32">
        <AnalyzeHeader session={session} />
        <Suspense fallback={<AnalyzeSectionSkeleton selected={false} />}>
          <AnalyzeSelectionFromUrl session={session} />
        </Suspense>
        {session === "guest" ? <GuestAnalysisTour /> : null}
      </div>
    </>
  );
}
