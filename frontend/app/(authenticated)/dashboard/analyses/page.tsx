import Link from "next/link";
import { ArrowUpRight } from "lucide-react";

import { DashboardPageHeader } from "@/components/dashboard/dashboard-page-header";
import { buttonVariants } from "@/components/ui/button";
import { AnalysisHistoryList } from "@/features/analysis/history-list";
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

      <AnalysisHistoryList action={analyzeAction} />
    </div>
  );
}
