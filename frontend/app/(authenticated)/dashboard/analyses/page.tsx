import Link from "next/link";
import { ArrowUpRight, ScanLine } from "lucide-react";

import { DashboardEmptyState } from "@/components/dashboard/dashboard-empty-state";
import { DashboardPageHeader } from "@/components/dashboard/dashboard-page-header";
import { DashboardSection } from "@/components/dashboard/dashboard-section";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const analyzeAction = (
  <Link
    href="/analyze"
    className={cn(buttonVariants({ variant: "brand", size: "lg" }), "gap-2")}
  >
    Analyze movement
    <ArrowUpRight className="size-4" aria-hidden="true" />
  </Link>
);

export default function AnalysesPage() {
  return (
    <div className="space-y-8">
      <DashboardPageHeader
        eyebrow="Movement record"
        title="Your analyses."
        description="A place for completed movement reviews and the training decisions they inform."
        action={analyzeAction}
      />

      <DashboardSection
        eyebrow="Saved sessions"
        title="Analysis history"
        description="Completed sessions will be listed here when your private analysis history is connected."
      >
        <DashboardEmptyState
          icon={<ScanLine className="size-5" aria-hidden="true" />}
          title="No saved analyses to display yet."
          description="Start with a movement analysis. Your saved sessions will have a clear home here."
          action={analyzeAction}
        />
      </DashboardSection>
    </div>
  );
}
