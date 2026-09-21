"use client";

import Link from "next/link";
import { ArrowUpRight, Check, Dumbbell, ExternalLink, X } from "lucide-react";
import { useRouter } from "next/navigation";

import { DashboardEmptyState } from "@/components/dashboard/dashboard-empty-state";
import { DashboardSection } from "@/components/dashboard/dashboard-section";
import { MovementDetailSkeleton } from "@/components/admin/admin-skeletons";
import { MovementForm } from "@/components/admin/movement-form";
import { AdminDataError } from "@/components/admin/admin-movements-client";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { getAdminErrorMessage } from "@/features/admin/errors";
import { useAdminMovement, useUpdateAdminMovement } from "@/features/admin/movements/hooks";

export function AdminMovementDetailClient({ slug }: { slug: string }) {
  const router = useRouter();
  const movement = useAdminMovement(slug);
  const updateMovement = useUpdateAdminMovement();

  if (movement.isPending) {
    return <MovementDetailSkeleton />;
  }

  if (movement.isError) {
    return <AdminDataError title="Movement unavailable" message={getAdminErrorMessage(movement.error)} onRetry={() => void movement.refetch()} />;
  }

  if (!movement.data) {
    return (
      <DashboardEmptyState
        icon={<Dumbbell className="size-5" aria-hidden="true" />}
        title="Movement not found"
        description="The current movement endpoint did not return a record for this slug."
      />
    );
  }

  const record = movement.data;

  async function handleSubmit(payload: Parameters<React.ComponentProps<typeof MovementForm>["onSubmit"]>[0]) {
    try {
      const updated = await updateMovement.mutateAsync({
        movementId: record.id,
        slug: record.slug,
        payload,
      });
      if (updated.slug !== record.slug) {
        router.replace(`/admin/movements/${encodeURIComponent(updated.slug)}`);
      }
    } catch {
      // The mutation hook provides toast feedback; keep the editor mounted.
    }
  }

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1.4fr)_minmax(280px,0.7fr)]">
      <DashboardSection eyebrow="Movement record" title={record.name} description="Edit catalog metadata and the product capabilities controlled by this movement record.">
        <MovementForm key={`${record.id}-${record.slug}`} movement={record} saving={updateMovement.isPending} onSubmit={handleSubmit} />
        {updateMovement.isError ? <p className="border-t border-destructive/20 bg-destructive/5 px-5 py-3 text-sm text-destructive sm:px-7">{getAdminErrorMessage(updateMovement.error)}</p> : null}
      </DashboardSection>

      <div className="space-y-5">
        <DashboardSection eyebrow="Availability" title="Product capabilities">
          <div className="space-y-3 px-5 py-6 sm:px-7">
            <Capability label="Upload analysis" value={record.upload_analysis_supported} />
            <Capability label="Live coach" value={record.live_coach_supported} />
          </div>
        </DashboardSection>
        <DashboardSection eyebrow="Documentation" title="Guide connection">
          <div className="space-y-4 px-5 py-6 sm:px-7">
            <div>
              <p className="text-xs text-foreground-faint">Published guide</p>
              <p className="mt-1 text-sm text-foreground-soft">
                {record.published_documentation_version ? `Version ${record.published_documentation_version}` : "No published guide yet"}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {record.published_documentation_id ? <Link href={`/admin/documentation/${record.published_documentation_id}`} className={buttonVariants({ variant: "brand", size: "sm" })}>Open documentation<ArrowUpRight className="size-3.5" aria-hidden="true" /></Link> : null}
              {record.published_documentation_id ? <Link href={`/movements/${encodeURIComponent(record.slug)}`} className={buttonVariants({ variant: "outline", size: "sm" })}>Public guide<ExternalLink className="size-3.5" aria-hidden="true" /></Link> : null}
            </div>
            {!record.published_documentation_id ? <p className="text-xs leading-5 text-foreground-faint">Create a documentation draft separately when this movement is ready for guidance content.</p> : null}
          </div>
        </DashboardSection>
      </div>
    </div>
  );
}

function Capability({ label, value }: { label: string; value: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="text-foreground-soft">{label}</span>
      <Badge variant={value ? "default" : "outline"}>
        {value ? <Check className="size-3" aria-hidden="true" /> : <X className="size-3" aria-hidden="true" />}
        {value ? "Enabled" : "Unavailable"}
      </Badge>
    </div>
  );
}
