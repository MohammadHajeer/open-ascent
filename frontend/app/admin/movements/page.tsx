import { Dumbbell } from "lucide-react";

import { DashboardEmptyState } from "@/components/dashboard/dashboard-empty-state";
import { DashboardPageHeader } from "@/components/dashboard/dashboard-page-header";
import { DashboardSection } from "@/components/dashboard/dashboard-section";

export default function AdminMovementsPage() {
  return (
    <div className="space-y-8">
      <DashboardPageHeader
        eyebrow="Admin / Movement library"
        title="Movement catalog."
        description="Manage movement definitions and their availability from one workspace."
      />

      <DashboardSection
        eyebrow="Catalog"
        title="Movements"
        description="The movement list and management actions will connect here."
      >
        <DashboardEmptyState
          icon={<Dumbbell className="size-5" aria-hidden="true" />}
          title="No movement records to display yet."
          description="Catalog entries will appear here when the admin movement data is connected."
        />
      </DashboardSection>
    </div>
  );
}
