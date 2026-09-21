"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertCircle, ArrowLeft, LoaderCircle } from "lucide-react";

import { AnalysisResults } from "@/components/analyze/analysis-results";
import { DashboardEmptyState } from "@/components/dashboard/dashboard-empty-state";
import { DashboardPageHeader } from "@/components/dashboard/dashboard-page-header";
import { DashboardSection } from "@/components/dashboard/dashboard-section";
import { buttonVariants } from "@/components/ui/button";

import { useAnalysisResult } from "./hooks";

export function AuthenticatedAnalysisDetail({ id }: { id: string }) {
  const router = useRouter();
  const analysis = useAnalysisResult(id);
  const back = (
    <Link
      href="/dashboard/analyses"
      className={buttonVariants({ variant: "outline" })}
    >
      <ArrowLeft className="size-4" aria-hidden="true" /> All analyses
    </Link>
  );
  return (
    <div className="space-y-8">
      <DashboardPageHeader
        eyebrow="Movement record / Detail"
        title="Analysis detail."
        description="A saved movement result. The original video is not retained."
        action={back}
      />
      {analysis.isPending ? (
        <div
          className="flex min-h-72 items-center justify-center gap-3 rounded-2xl border border-border bg-card text-sm text-foreground-soft"
          role="status"
        >
          <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />{" "}
          Loading analysis…
        </div>
      ) : analysis.isError || !analysis.data?.result ? (
        <DashboardSection
          eyebrow="Unavailable record"
          title="This analysis could not be opened."
        >
          <DashboardEmptyState
            icon={<AlertCircle className="size-5" aria-hidden="true" />}
            title="Analysis result unavailable."
            description="The record may not exist, may not belong to this account, or may still be processing."
            action={back}
          />
        </DashboardSection>
      ) : (
        <AnalysisResults
          analysis={analysis.data}
          access={{ analysis_id: id, kind: "authenticated" }}
          authenticated
          videoUrl={null}
          onRestart={() => router.push("/analyze")}
        />
      )}
    </div>
  );
}
