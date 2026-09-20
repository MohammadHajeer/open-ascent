import Link from "next/link";
import { ArrowLeft, SearchX } from "lucide-react";

import { DashboardEmptyState } from "@/components/dashboard/dashboard-empty-state";
import { DashboardPageHeader } from "@/components/dashboard/dashboard-page-header";
import { DashboardSection } from "@/components/dashboard/dashboard-section";
import { buttonVariants } from "@/components/ui/button";

export default function AnalysisNotFound() {
  return (
    <div className="space-y-8">
      <DashboardPageHeader eyebrow="Movement record / Detail" title="Analysis not found." />
      <DashboardSection eyebrow="Unavailable record" title="This analysis could not be opened.">
        <DashboardEmptyState
          icon={<SearchX className="size-5" aria-hidden="true" />}
          title="There is no analysis at this address."
          description="Check the link or return to your analysis history."
          action={
            <Link href="/dashboard/analyses" className={buttonVariants({ variant: "outline" })}>
              <ArrowLeft className="size-4" aria-hidden="true" />
              All analyses
            </Link>
          }
        />
      </DashboardSection>
    </div>
  );
}
