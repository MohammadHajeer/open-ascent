"use client";

import Link from "next/link";
import { AlertCircle, LoaderCircle } from "lucide-react";

import { DashboardEmptyState } from "@/components/dashboard/dashboard-empty-state";
import { DashboardSection } from "@/components/dashboard/dashboard-section";
import { ThemedAsset } from "@/components/shared/themed-asset";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { assets } from "@/lib/assets";

import { useAnalysisHistory } from "./hooks";

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function AnalysisHistoryList({ action }: { action: React.ReactNode }) {
  const history = useAnalysisHistory();
  if (history.isPending) {
    return (
      <DashboardSection eyebrow="Saved sessions" title="Analysis history">
        <div
          className="flex min-h-48 items-center justify-center gap-3 text-sm text-foreground-soft"
          role="status"
        >
          <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />{" "}
          Loading your analyses…
        </div>
      </DashboardSection>
    );
  }
  if (history.isError) {
    return (
      <DashboardSection eyebrow="Saved sessions" title="Analysis history">
        <DashboardEmptyState
          icon={<AlertCircle className="size-5" aria-hidden="true" />}
          title="Your analysis history could not be loaded."
          description="Refresh the page to try again."
        />
      </DashboardSection>
    );
  }
  if (!history.data.length) {
    return (
      <DashboardSection eyebrow="Saved sessions" title="Analysis history">
        <DashboardEmptyState
          visual={<ThemedAsset asset={assets.emptyStates.noAnalyses} alt="" width={176} />}
          title="No saved analyses yet."
          description="Complete a movement analysis and its result will appear here. Raw videos are not retained."
          action={action}
        />
      </DashboardSection>
    );
  }
  return (
    <DashboardSection
      eyebrow="Saved sessions"
      title="Analysis history"
      description="Saved results remain available after raw video deletion."
    >
      <div className="divide-y divide-border overflow-hidden rounded-2xl border border-border">
        {history.data.map((analysis) => (
          <article
            key={analysis.analysis_id}
            className="flex flex-wrap items-center justify-between gap-5 bg-card p-5 sm:p-6"
          >
            <div>
              <div className="flex flex-wrap items-center gap-3">
                <h3 className="font-semibold text-foreground">
                  {analysis.movement.name}
                </h3>
                <Badge variant="outline" className="capitalize">
                  {analysis.status}
                </Badge>
              </div>
              <p className="mt-2 text-xs text-foreground-soft">
                {formatDate(analysis.created_at)}
              </p>
              {analysis.status === "completed" && (
                <p className="mt-3 text-sm text-foreground-soft">
                  {analysis.valid_rep_count ?? 0} valid ·{" "}
                  {analysis.partial_rep_count ?? 0} partial ·{" "}
                  {analysis.uncertain_rep_count ?? 0} uncertain
                </p>
              )}
            </div>
            {analysis.status === "completed" ? (
              <Link
                href={`/dashboard/analyses/${analysis.analysis_id}`}
                className={buttonVariants({ variant: "outline" })}
              >
                Open result
              </Link>
            ) : (
              <span className="text-xs text-foreground-faint">
                {analysis.stage.replaceAll("_", " ")}
              </span>
            )}
          </article>
        ))}
      </div>
    </DashboardSection>
  );
}
