"use client";

import Link from "next/link";
import { ArrowUpRight, Check, Dumbbell, ExternalLink, X } from "lucide-react";

import { DashboardEmptyState } from "@/components/dashboard/dashboard-empty-state";
import { DashboardSection } from "@/components/dashboard/dashboard-section";
import { AdminDataError } from "@/components/admin/admin-movements-client";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { getAdminErrorMessage } from "@/features/admin/errors";
import { useAdminMovement } from "@/features/admin/movements/hooks";
import { cn } from "@/lib/utils";

export function AdminMovementDetailClient({ slug }: { slug: string }) {
  const movement = useAdminMovement(slug);

  if (movement.isPending) {
    return (
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.4fr)_minmax(280px,0.7fr)]">
        <div className="h-96 animate-pulse rounded-[1.6rem] bg-muted/50" />
        <div className="h-72 animate-pulse rounded-[1.6rem] bg-muted/50" />
      </div>
    );
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

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1.4fr)_minmax(280px,0.7fr)]">
      <DashboardSection eyebrow="Movement record" title={record.name} description="Catalog metadata returned by the existing movement guide endpoint.">
        <div className="grid gap-px bg-border/60 sm:grid-cols-2">
          <Detail label="Slug" value={record.slug} mono />
          <Detail label="Family key" value={record.family_key} mono />
          <Detail label="Difficulty" value={record.difficulty} />
          <Detail label="Live coach" value={record.live_coach_supported ? "Supported" : "Not supported"} />
          <Detail label="Upload analysis" value={record.upload_analysis_supported ? "Supported" : "Not supported"} />
          <Detail label="Published guide" value={`Version ${record.documentation.version}`} />
        </div>
        <div className="flex flex-wrap gap-3 border-t border-border/70 px-5 py-5 sm:px-7">
          <Link href={`/admin/documentation/${record.documentation.id}`} className={buttonVariants({ variant: "brand" })}>
            Open documentation
            <ArrowUpRight className="size-4" aria-hidden="true" />
          </Link>
          <Link href={`/movements/${encodeURIComponent(record.slug)}`} className={buttonVariants({ variant: "outline" })}>
            Public guide
            <ExternalLink className="size-4" aria-hidden="true" />
          </Link>
        </div>
      </DashboardSection>

      <div className="space-y-5">
        <DashboardSection eyebrow="Availability" title="Product capabilities">
          <div className="space-y-3 px-5 py-6 sm:px-7">
            <Capability label="Upload analysis" value={record.upload_analysis_supported} />
            <Capability label="Live coach" value={record.live_coach_supported} />
          </div>
        </DashboardSection>
        <DashboardSection eyebrow="Admin API gap" title="Metadata editing unavailable">
          <p className="px-5 py-6 text-sm leading-6 text-foreground-soft sm:px-7">
            The backend currently exposes movement data through public read endpoints only. No admin movement list, create, or update endpoint exists, so this surface intentionally does not offer a fake edit action.
          </p>
        </DashboardSection>
      </div>
    </div>
  );
}

function Detail({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="bg-card/75 px-5 py-5 sm:px-7">
      <dt className="font-mono text-[0.58rem] font-semibold tracking-[0.13em] text-foreground-faint uppercase">{label}</dt>
      <dd className={cn("mt-2 text-sm text-foreground-soft", mono && "font-mono text-xs")}>{value}</dd>
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
