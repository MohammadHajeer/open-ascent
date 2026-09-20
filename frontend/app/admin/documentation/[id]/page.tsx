import Link from "next/link";
import { ArrowLeft, FileText, ShieldCheck } from "lucide-react";

import { DashboardEmptyState } from "@/components/dashboard/dashboard-empty-state";
import { DashboardPageHeader } from "@/components/dashboard/dashboard-page-header";
import { DashboardSection } from "@/components/dashboard/dashboard-section";
import { buttonVariants } from "@/components/ui/button";

export default function AdminDocumentationDetailPage() {
  return (
    <div className="space-y-8">
      <DashboardPageHeader
        eyebrow="Admin / Documentation / Detail"
        title="Guide workspace."
        description="Content, safety guidance, and publishing controls for one movement guide."
        action={
          <Link href="/admin/documentation" className={buttonVariants({ variant: "outline" })}>
            <ArrowLeft className="size-4" aria-hidden="true" />
            All documentation
          </Link>
        }
      />

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.5fr)_minmax(280px,0.7fr)]">
        <DashboardSection
          eyebrow="Guide content"
          title="Movement guide"
          description="The editable guide will be connected here."
        >
          <DashboardEmptyState
            icon={<FileText className="size-5" aria-hidden="true" />}
            title="Guide content is not available yet."
            description="Open a connected documentation record to edit its content."
          />
        </DashboardSection>

        <div className="space-y-5">
          <DashboardSection eyebrow="Safety" title="Safety guidance">
            <div className="flex gap-3 px-5 py-6 sm:px-7">
              <ShieldCheck className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden="true" />
              <p className="text-sm leading-6 text-foreground-soft">
                Movement-specific cautions and guidance will be managed here.
              </p>
            </div>
          </DashboardSection>
          <DashboardSection eyebrow="Publication" title="Guide status">
            <p className="px-5 py-6 text-sm leading-6 text-foreground-soft sm:px-7">
              Draft, published, and archived states will be available when guide management is connected.
            </p>
          </DashboardSection>
        </div>
      </div>
    </div>
  );
}
