import { AdminMovementCreateClient } from "@/components/admin/admin-movement-create-client";
import { DashboardPageHeader } from "@/components/dashboard/dashboard-page-header";

export default function AdminMovementCreatePage() {
  return (
    <div className="space-y-8">
      <DashboardPageHeader
        eyebrow="Admin / Movement library / New"
        title="Add a movement."
        description="Define catalog metadata and product availability without creating documentation automatically."
      />
      <AdminMovementCreateClient />
    </div>
  );
}
