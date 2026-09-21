import Link from "next/link";
import { ArrowUpRight } from "lucide-react";

import { DashboardEmptyState } from "@/components/dashboard/dashboard-empty-state";
import { DashboardPageHeader } from "@/components/dashboard/dashboard-page-header";
import { DashboardSection } from "@/components/dashboard/dashboard-section";
import { ThemedAsset } from "@/components/shared/themed-asset";
import { buttonVariants } from "@/components/ui/button";
import { assets } from "@/lib/assets";
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

export default function TrainPage() {
  return (
    <div className="space-y-8">
      <DashboardPageHeader
        eyebrow="Training workspace"
        title="Train with intention."
        description="Training sessions and movement analysis workflows will have a home here as your athlete workspace grows."
      />

      <DashboardSection
        eyebrow="Next phase"
        title="Your training space is ready to take shape."
        description="Start with a movement analysis today. Structured training workflows will connect here in a later release."
      >
        <DashboardEmptyState
          title="No training sessions yet."
          description="There is no session data to show yet, so this space stays focused on what comes next."
          action={analyzeAction}
          visual={
            <ThemedAsset
              asset={assets.emptyStates.noTrainingPlan}
              alt=""
              width={176}
            />
          }
        />
      </DashboardSection>
    </div>
  );
}
