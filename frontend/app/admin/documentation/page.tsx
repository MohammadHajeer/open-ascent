import { AdminDocumentationClient } from "@/components/admin/admin-documentation-client";

import { DashboardPageHeader } from "@/components/dashboard/dashboard-page-header";

export default function AdminDocumentationPage() {
  return (
    <div className="space-y-8">
      <DashboardPageHeader
        eyebrow="Admin / Documentation"
        title="Movement guidance."
        description="Draft, edit, review, and publish structured movement safety guidance."
      />

      <AdminDocumentationClient />
    </div>
  );
}
