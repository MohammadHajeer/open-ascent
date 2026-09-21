"use client";

import Link from "next/link";
import { AlertCircle, ArrowUpRight, Check, Dumbbell, Search, X } from "lucide-react";
import { useMemo, useState } from "react";

import { DashboardEmptyState } from "@/components/dashboard/dashboard-empty-state";
import { DashboardSection } from "@/components/dashboard/dashboard-section";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { buttonVariants } from "@/components/ui/button";
import { getAdminErrorMessage } from "@/features/admin/errors";
import { useAdminMovements } from "@/features/admin/movements/hooks";
import { cn } from "@/lib/utils";

export function AdminMovementsClient() {
  const movements = useAdminMovements();
  const [search, setSearch] = useState("");

  const filteredMovements = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return movements.data ?? [];

    return (movements.data ?? []).filter((movement) =>
      [movement.name, movement.slug, movement.family_key]
        .join(" ")
        .toLowerCase()
        .includes(query),
    );
  }, [movements.data, search]);

  if (movements.isPending) {
    return <MovementListSkeleton />;
  }

  if (movements.isError) {
    return (
      <AdminDataError
        title="Movement catalog unavailable"
        message={getAdminErrorMessage(movements.error)}
        onRetry={() => void movements.refetch()}
      />
    );
  }

  if (!movements.data.length) {
    return (
      <DashboardSection
        eyebrow="Catalog"
        title="Movements"
        description="The API currently exposes movements with published guides through the public catalog endpoint."
      >
        <DashboardEmptyState
          icon={<Dumbbell className="size-5" aria-hidden="true" />}
          title="No published movement records"
          description="No movement records are available from the current backend contract. Admin movement list/create/update endpoints are not implemented yet."
        />
      </DashboardSection>
    );
  }

  return (
    <DashboardSection
      eyebrow="Catalog"
      title={`${movements.data.length} movement${movements.data.length === 1 ? "" : "s"}`}
      description="Read-only catalog data from the existing movement endpoint. Metadata editing will become available when admin movement write endpoints exist."
      aside={
        <label className="relative block w-full sm:w-64">
          <span className="sr-only">Search movements</span>
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-foreground-faint" aria-hidden="true" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search catalog"
            className="h-9 pl-9"
          />
        </label>
      }
    >
      {!filteredMovements.length ? (
        <DashboardEmptyState
          icon={<Search className="size-5" aria-hidden="true" />}
          title="No matching movements"
          description="Try a different name, slug, or family key."
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-180 text-left text-sm">
            <thead className="border-b border-border/70 bg-background-alt/35 text-xs text-foreground-soft">
              <tr>
                <th className="px-5 py-3 font-medium sm:px-7">Movement</th>
                <th className="px-5 py-3 font-medium sm:px-7">Family</th>
                <th className="px-5 py-3 font-medium sm:px-7">Difficulty</th>
                <th className="px-5 py-3 font-medium sm:px-7">Analysis</th>
                <th className="px-5 py-3 font-medium sm:px-7">Guide</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {filteredMovements.map((movement) => (
                <tr key={movement.id} className="group align-middle">
                  <td className="px-5 py-4 sm:px-7">
                    <Link
                      href={`/admin/movements/${encodeURIComponent(movement.slug)}`}
                      className="group/link inline-flex items-center gap-3 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <span className="grid size-9 place-items-center rounded-xl border border-primary/15 bg-primary-light text-primary">
                        <Dumbbell className="size-4" aria-hidden="true" />
                      </span>
                      <span>
                        <span className="block font-medium text-foreground group-hover/link:text-primary">
                          {movement.name}
                        </span>
                        <span className="mt-0.5 block font-mono text-[0.68rem] text-foreground-faint">
                          {movement.slug}
                        </span>
                      </span>
                    </Link>
                  </td>
                  <td className="px-5 py-4 font-mono text-xs text-foreground-soft sm:px-7">
                    {movement.family_key}
                  </td>
                  <td className="px-5 py-4 capitalize text-foreground-soft sm:px-7">
                    {movement.difficulty}
                  </td>
                  <td className="px-5 py-4 sm:px-7">
                    <CapabilityValue value={movement.upload_analysis_supported} label="Upload" />
                  </td>
                  <td className="px-5 py-4 sm:px-7">
                    <Link
                      href={`/admin/movements/${encodeURIComponent(movement.slug)}`}
                      className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "text-foreground-soft")}
                    >
                      Open
                      <ArrowUpRight className="size-3.5" aria-hidden="true" />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </DashboardSection>
  );
}

function CapabilityValue({ value, label }: { value: boolean; label: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-xs", value ? "text-primary" : "text-foreground-faint")}>
      {value ? <Check className="size-3.5" aria-hidden="true" /> : <X className="size-3.5" aria-hidden="true" />}
      {label}
    </span>
  );
}

function MovementListSkeleton() {
  return (
    <DashboardSection eyebrow="Catalog" title="Loading movements…">
      <div className="space-y-3 p-5 sm:p-7">
        {[1, 2, 3].map((item) => (
          <div key={item} className="h-16 animate-pulse rounded-xl bg-muted/50" />
        ))}
      </div>
    </DashboardSection>
  );
}

export function AdminDataError({
  title,
  message,
  onRetry,
}: {
  title: string;
  message: string;
  onRetry?: () => void;
}) {
  return (
    <Alert variant="destructive">
      <AlertCircle />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>
        <span>{message}</span>
        {onRetry ? (
          <button type="button" onClick={onRetry} className="mt-2 block font-medium underline underline-offset-4">
            Try again
          </button>
        ) : null}
      </AlertDescription>
    </Alert>
  );
}
