import { AdminMovementsClient } from "@/components/admin/admin-movements-client";
import { DashboardPageHeader } from "@/components/dashboard/dashboard-page-header";

export default function AdminMovementsPage() {
  return (
    <div className="space-y-8">
      <DashboardPageHeader
        eyebrow="Admin / Movement library"
        title="Movement catalog."
        description="Create and maintain movement metadata and product capabilities from the admin catalog."
      />

      <AdminMovementsClient />
    </div>
  );
}
