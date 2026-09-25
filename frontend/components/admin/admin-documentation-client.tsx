"use client";

import Link from "next/link";
import { FilePlus2, Filter, Search } from "lucide-react";
import { useState } from "react";
import { useRouter } from "next/navigation";

import { DashboardEmptyState } from "@/components/dashboard/dashboard-empty-state";
import { DashboardSection } from "@/components/dashboard/dashboard-section";
import { AdminDataError } from "@/components/admin/admin-movements-client";
import { DocumentationStatusBadge } from "@/components/admin/documentation-status-badge";
import { DocumentationListSkeleton } from "@/components/admin/admin-skeletons";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  useAdminDocumentation,
  useCreateDocumentationDraft,
} from "@/features/admin/documentation/hooks";
import type {
  AdminDocumentationSummary,
  DocumentationStatus,
} from "@/features/admin/documentation/types";
import { getAdminErrorMessage } from "@/features/admin/errors";
import { useAdminMovements } from "@/features/admin/movements/hooks";
import { cn } from "@/lib/utils";

const statusOptions: Array<"all" | DocumentationStatus> = ["all", "draft", "published", "archived"];

export function AdminDocumentationClient() {
  const router = useRouter();
  const [status, setStatus] = useState<"all" | DocumentationStatus>("all");
  const [filterMovementId, setFilterMovementId] = useState("all");
  const [createMovementId, setCreateMovementId] = useState("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const documentation = useAdminDocumentation({ page, status, movementId: filterMovementId, search });
  const movements = useAdminMovements();
  const createDraft = useCreateDocumentationDraft();

  async function handleCreateDraft() {
    const target = movements.data?.find((movement) => movement.id === createMovementId);
    if (!target) return;

    try {
      const created = await createDraft.mutateAsync({ movementId: target.id });
      router.push(`/admin/documentation/${created.id}`);
    } catch {
      // The mutation error is rendered beside the action.
    }
  }

  if (documentation.isPending) {
    return <DocumentationListSkeleton />;
  }

  if (documentation.isError) {
    return <AdminDataError title="Documentation workspace unavailable" message={getAdminErrorMessage(documentation.error)} onRetry={() => void documentation.refetch()} />;
  }

  return (
    <div className="space-y-5">
      <DashboardSection
        eyebrow="Draft workflow"
        title="Create a documentation draft"
        description="Choose a movement to start a safety guide draft."
        aside={<FilePlus2 className="size-5 text-primary" aria-hidden="true" />}
      >
        <div className="flex flex-col gap-3 px-5 py-5 sm:flex-row sm:items-end sm:px-7">
          <label className="block min-w-0 flex-1">
            <span className="mb-2 block text-xs font-medium text-foreground-soft">Target movement</span>
            <Select value={createMovementId} onValueChange={(value) => setCreateMovementId(value ?? "all")} disabled={movements.isPending || movements.isError}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Choose a movement" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all" disabled>Choose a movement</SelectItem>
                {(movements.data ?? []).map((movement) => (
                  <SelectItem key={movement.id} value={movement.id}>{movement.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          <Button type="button" variant="brand" disabled={createMovementId === "all" || createDraft.isPending} onClick={() => void handleCreateDraft()}>
            <FilePlus2 className="size-4" aria-hidden="true" />
            {createDraft.isPending ? "Creating…" : "Create draft"}
          </Button>
        </div>
        {createDraft.isError ? (
          <p className="border-t border-destructive/20 bg-destructive/5 px-5 py-3 text-sm text-destructive sm:px-7">
            {getAdminErrorMessage(createDraft.error)}
          </p>
        ) : null}
        {movements.isError ? <p className="px-5 pb-4 text-sm text-destructive sm:px-7">Movement choices are unavailable. <Button variant="outline" size="sm" onClick={() => void movements.refetch()}>Retry</Button></p> : null}
      </DashboardSection>

      <DashboardSection
        eyebrow="Guide library"
        title="Documentation records"
        description="Paginated versions across the movement library."
        aside={<Filter className="size-5 text-primary" aria-hidden="true" />}
      >
        <div className="grid gap-3 border-b border-border/70 bg-background-alt/25 px-5 py-4 sm:grid-cols-[minmax(180px,1fr)_180px_220px] sm:px-7">
          <label className="relative block">
            <span className="sr-only">Search documentation</span>
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-foreground-faint" aria-hidden="true" />
            <Input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="Search movement" className="h-9 pl-9" maxLength={80} />
          </label>
          <Select value={status} onValueChange={(value) => { setStatus((value ?? "all") as "all" | DocumentationStatus); setPage(1); }}>
            <SelectTrigger className="h-9 w-full"><SelectValue placeholder="All statuses" /></SelectTrigger>
            <SelectContent>
              {statusOptions.map((option) => <SelectItem key={option} value={option}>{option === "all" ? "All statuses" : option}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={filterMovementId} onValueChange={(value) => { setFilterMovementId(value ?? "all"); setPage(1); }} disabled={movements.isError}>
            <SelectTrigger className="h-9 w-full"><SelectValue placeholder="All movements" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All movements</SelectItem>
              {(movements.data ?? []).map((movement) => <SelectItem key={movement.id} value={movement.id}>{movement.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        {!documentation.data?.total ? (
          <DashboardEmptyState icon={<Search className="size-5" aria-hidden="true" />} title="No matching records" description="Adjust the filters to see another documentation version." />
        ) : (
          <><DocumentationTable records={documentation.data.items} /><div className="flex items-center justify-between gap-3 border-t border-border px-5 py-4 text-xs text-foreground-soft sm:px-7"><span>Page {page} of {Math.max(1, Math.ceil(documentation.data.total / documentation.data.page_size))} · {documentation.data.total} records</span><div className="flex gap-2"><Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button><Button variant="outline" size="sm" disabled={page * documentation.data.page_size >= documentation.data.total} onClick={() => setPage(page + 1)}>Next</Button></div></div></>
        )}
      </DashboardSection>
    </div>
  );
}

function DocumentationTable({ records }: { records: AdminDocumentationSummary[] }) {
  return (
    <Table className="min-w-190">
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead>Movement</TableHead>
          <TableHead>Version</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Updated</TableHead>
          <TableHead>Published</TableHead>
          <TableHead><span className="sr-only">Open</span></TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {records.map((record) => (
          <TableRow key={record.id}>
            <TableCell>
              <Link href={`/admin/documentation/${record.id}`} className="font-medium text-foreground hover:text-primary">
                {record.movement.name}
              </Link>
              <span className="mt-1 block font-mono text-[0.68rem] text-foreground-faint">{record.movement.slug}</span>
            </TableCell>
            <TableCell className="font-mono text-xs text-foreground-soft">v{record.version}</TableCell>
            <TableCell><DocumentationStatusBadge status={record.status} /></TableCell>
            <TableCell className="text-xs text-foreground-soft">{formatDate(record.updated_at)}</TableCell>
            <TableCell className="text-xs text-foreground-soft">{record.published_at ? formatDate(record.published_at) : "—"}</TableCell>
            <TableCell><Link href={`/admin/documentation/${record.id}`} className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "text-foreground-soft")}>Open</Link></TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(new Date(value));
}
