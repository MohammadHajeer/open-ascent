import { Archive, FileText, Send } from "lucide-react";

import { DashboardEmptyState } from "@/components/dashboard/dashboard-empty-state";
import { DashboardPageHeader } from "@/components/dashboard/dashboard-page-header";
import { DashboardSection } from "@/components/dashboard/dashboard-section";

const statuses = [
  { label: "Draft", icon: FileText, description: "Guides being written" },
  { label: "Published", icon: Send, description: "Guides available to athletes" },
  { label: "Archived", icon: Archive, description: "Guides retained from earlier versions" },
];

export default function AdminDocumentationPage() {
  return (
    <div className="space-y-8">
      <DashboardPageHeader
        eyebrow="Admin / Documentation"
        title="Movement guidance."
        description="The publishing workspace for movement guides and safety content."
      />

      <div className="grid gap-3 md:grid-cols-3">
        {statuses.map(({ label, icon: Icon, description }) => (
          <div
            key={label}
            className="flex items-start gap-3 rounded-[1.2rem] border border-border/75 bg-background-alt/55 p-5"
          >
            <Icon className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
            <div>
              <h2 className="text-sm font-medium">{label}</h2>
              <p className="mt-1 text-xs leading-5 text-foreground-soft">
                {description}
              </p>
            </div>
          </div>
        ))}
      </div>

      <DashboardSection
        eyebrow="Guide library"
        title="Documentation records"
        description="Draft, published, and archived guides will be managed here."
      >
        <DashboardEmptyState
          icon={<FileText className="size-5" aria-hidden="true" />}
          title="No documentation records to display yet."
          description="Movement guides will appear here when the documentation workspace is connected."
        />
      </DashboardSection>
    </div>
  );
}
