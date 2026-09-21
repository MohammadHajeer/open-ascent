import { Info } from "lucide-react";

import { AdminMovementsClient } from "@/components/admin/admin-movements-client";
import { DashboardPageHeader } from "@/components/dashboard/dashboard-page-header";
import { Alert, AlertDescription } from "@/components/ui/alert";

export default function AdminMovementsPage() {
  return (
    <div className="space-y-8">
      <DashboardPageHeader
        eyebrow="Admin / Movement library"
        title="Movement catalog."
        description="Inspect movement definitions and product capabilities from the existing catalog contract."
      />

      <Alert>
        <Info />
        <AlertDescription>
          Movement create/update endpoints are not present in the current
          FastAPI contract, so this page intentionally stays read-only.
          Documentation management remains available below and uses the admin
          lifecycle endpoints.
        </AlertDescription>
      </Alert>

      <AdminMovementsClient />
    </div>
  );
}
