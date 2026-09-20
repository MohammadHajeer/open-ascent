import Link from "next/link";
import { ArrowLeft, Dumbbell } from "lucide-react";

import { DashboardEmptyState } from "@/components/dashboard/dashboard-empty-state";
import { DashboardPageHeader } from "@/components/dashboard/dashboard-page-header";
import { DashboardSection } from "@/components/dashboard/dashboard-section";
import { buttonVariants } from "@/components/ui/button";

export default function AdminMovementDetailPage() {
  return (
    <div className="space-y-8">
      <DashboardPageHeader
        eyebrow="Admin / Movement library / Detail"
        title="Movement workspace."
        description="Movement details and management controls will live here."
        action={
          <Link href="/admin/movements" className={buttonVariants({ variant: "outline" })}>
            <ArrowLeft className="size-4" aria-hidden="true" />
            All movements
          </Link>
        }
      />

      <DashboardSection
        eyebrow="Movement record"
        title="Definition and availability"
        description="A dedicated surface for one validated catalog movement."
      >
        <DashboardEmptyState
          icon={<Dumbbell className="size-5" aria-hidden="true" />}
          title="Movement details are not connected yet."
          description="The record, its guide, and management actions will appear here when admin data is available."
        />
      </DashboardSection>
    </div>
  );
}
