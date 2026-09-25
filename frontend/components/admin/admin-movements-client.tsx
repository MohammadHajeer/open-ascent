"use client";

import Link from "next/link";
import { AlertCircle, ArrowUpRight, Check, Dumbbell, Search, X } from "lucide-react";
import { useMemo, useState } from "react";

import { DashboardEmptyState } from "@/components/dashboard/dashboard-empty-state";
import { DashboardSection } from "@/components/dashboard/dashboard-section";
import { MovementListSkeleton } from "@/components/admin/admin-skeletons";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Button, buttonVariants } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
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
        description="Movement metadata and product capabilities managed by admins."
      >
        <DashboardEmptyState
          icon={<Dumbbell className="size-5" aria-hidden="true" />}
          title="No movement records"
          description="Create the first movement to start building the catalog."
          action={<Link href="/admin/movements/new" className={buttonVariants({ variant: "brand" })}>New movement</Link>}
        />
      </DashboardSection>
    );
  }

  return (
    <DashboardSection
      eyebrow="Catalog"
      title={`${movements.data.length} movement${movements.data.length === 1 ? "" : "s"}`}
      description="Movement metadata and analyzer availability from the admin catalog."
      stackAside
      aside={
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
          <label className="relative block w-full sm:w-64">
            <span className="sr-only">Search movements</span>
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-foreground-faint" aria-hidden="true" />
            <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search catalog" className="h-9 pl-9" />
          </label>
          <Link href="/admin/movements/new" className={buttonVariants({ variant: "brand", size: "sm" })}>New movement</Link>
        </div>
      }
    >
      {!filteredMovements.length ? (
        <DashboardEmptyState
          icon={<Search className="size-5" aria-hidden="true" />}
          title="No matching movements"
          description="Try a different name, slug, or family key."
        />
      ) : (
        <Table className="min-w-180">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Movement</TableHead>
              <TableHead>Family</TableHead>
              <TableHead>Difficulty</TableHead>
              <TableHead>Analysis</TableHead>
              <TableHead><span className="sr-only">Guide</span></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredMovements.map((movement) => (
              <TableRow key={movement.id}>
                <TableCell>
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
                </TableCell>
                <TableCell className="font-mono text-xs text-foreground-soft">
                  {movement.family_key}
                </TableCell>
                <TableCell className="capitalize text-foreground-soft">
                  {movement.difficulty ?? "—"}
                </TableCell>
                <TableCell>
                  <CapabilityValue value={movement.upload_analysis_supported} label="Upload" />
                </TableCell>
                <TableCell>
                  <Link
                    href={`/admin/movements/${encodeURIComponent(movement.slug)}`}
                    className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "text-foreground-soft")}
                  >
                    Open
                    <ArrowUpRight className="size-3.5" aria-hidden="true" />
                  </Link>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
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
          <Button type="button" variant="outline" size="sm" onClick={onRetry} className="mt-3">
            Try again
          </Button>
        ) : null}
      </AlertDescription>
    </Alert>
  );
}
