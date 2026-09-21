import Link from "next/link";
import { ArrowUpRight } from "lucide-react";

import { DashboardEmptyState } from "@/components/dashboard/dashboard-empty-state";
import { DashboardPageHeader } from "@/components/dashboard/dashboard-page-header";
import { DashboardSection } from "@/components/dashboard/dashboard-section";
import { ThemedAsset } from "@/components/shared/themed-asset";
import { buttonVariants } from "@/components/ui/button";
import { assets } from "@/lib/assets";
import { cn } from "@/lib/utils";

const analysesAction = (
  <Link
    href="/dashboard/analyses"
    className={cn(buttonVariants({ variant: "outline", size: "lg" }), "gap-2")}
  >
    Open analyses
    <ArrowUpRight className="size-4" aria-hidden="true" />
  </Link>
);

export default function LibraryPage() {
  return (
    <div className="space-y-8">
      <DashboardPageHeader
        eyebrow="Your movement record"
        title="Library"
        description="A future home for saved analyses, movement resources, and the training history you choose to keep close."
      />

      <DashboardSection
        eyebrow="Saved work"
        title="Nothing saved here yet."
        description="Your library will stay grounded in your own movement record and resources—not placeholder content."
      >
        <DashboardEmptyState
          title="Your library is ready for its first entry."
          description="Completed analyses will become easier to revisit here as private history is connected."
          action={analysesAction}
          visual={
            <ThemedAsset
              asset={assets.emptyStates.noAnalyses}
              alt=""
              width={176}
            />
          }
        />
      </DashboardSection>
    </div>
  );
}
