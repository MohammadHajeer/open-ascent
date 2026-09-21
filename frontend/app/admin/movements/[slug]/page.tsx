import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { AdminMovementDetailClient } from "@/components/admin/admin-movement-detail-client";
import { DashboardPageHeader } from "@/components/dashboard/dashboard-page-header";
import { buttonVariants } from "@/components/ui/button";

type AdminMovementDetailPageProps = {
  params: Promise<{ slug: string }>;
};

export default async function AdminMovementDetailPage({
  params,
}: AdminMovementDetailPageProps) {
  const { slug } = await params;

  return (
    <div className="space-y-8">
      <DashboardPageHeader
        eyebrow="Admin / Movement library / Detail"
        title="Movement workspace."
        description="Edit movement metadata while keeping documentation as a separate workflow."
        action={
          <Link
            href="/admin/movements"
            className={buttonVariants({ variant: "outline" })}
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
            All movements
          </Link>
        }
      />

      <AdminMovementDetailClient slug={slug} />
    </div>
  );
}
