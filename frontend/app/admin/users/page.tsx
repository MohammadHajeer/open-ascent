import { Users } from "lucide-react";

import { DashboardEmptyState } from "@/components/dashboard/dashboard-empty-state";
import { DashboardPageHeader } from "@/components/dashboard/dashboard-page-header";
import { DashboardSection } from "@/components/dashboard/dashboard-section";

export default function AdminUsersPage() {
  return (
    <div className="space-y-8">
      <DashboardPageHeader
        eyebrow="Admin / People"
        title="User administration."
        description="An organized workspace for account oversight when AUTH-02 is connected."
      />

      <DashboardSection
        eyebrow="Accounts"
        title="Users"
        description="The authorized user directory and account actions will appear here."
      >
        <DashboardEmptyState
          icon={<Users className="size-5" aria-hidden="true" />}
          title="No user records to display yet."
          description="Account information will appear after admin authorization and data access are connected."
        />
      </DashboardSection>
    </div>
  );
}
