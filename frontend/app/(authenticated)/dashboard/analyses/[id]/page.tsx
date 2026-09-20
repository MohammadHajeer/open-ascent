import Link from "next/link";
import { ArrowLeft, ScanLine } from "lucide-react";

import { DashboardEmptyState } from "@/components/dashboard/dashboard-empty-state";
import { DashboardPageHeader } from "@/components/dashboard/dashboard-page-header";
import { DashboardSection } from "@/components/dashboard/dashboard-section";
import { buttonVariants } from "@/components/ui/button";

export default function AnalysisDetailPage() {
  return (
    <div className="space-y-8">
      <DashboardPageHeader
        eyebrow="Movement record / Detail"
        title="Analysis detail."
        description="A dedicated workspace for one saved movement review."
        action={
          <Link href="/dashboard/analyses" className={buttonVariants({ variant: "outline" })}>
            <ArrowLeft className="size-4" aria-hidden="true" />
            All analyses
          </Link>
        }
      />

      <DashboardSection
        eyebrow="Session view"
        title="Movement review"
        description="The analysis summary and evidence will load here when private history is connected."
      >
        <DashboardEmptyState
          icon={<ScanLine className="size-5" aria-hidden="true" />}
          title="Analysis detail is not available yet."
          description="Return to your analyses or start a new movement review."
          action={
            <Link href="/dashboard/analyses" className={buttonVariants({ variant: "outline" })}>
              Back to analyses
            </Link>
          }
        />
      </DashboardSection>
    </div>
  );
}
