"use client";

import Link from "next/link";
import { FilePlus2, FileText, Filter, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { DashboardEmptyState } from "@/components/dashboard/dashboard-empty-state";
import { DashboardSection } from "@/components/dashboard/dashboard-section";
import { AdminDataError } from "@/components/admin/admin-movements-client";
import { DocumentationStatusBadge } from "@/components/admin/documentation-status-badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  AdminDocumentationRecord,
  DocumentationStatus,
} from "@/features/admin/documentation/types";
import { getAdminErrorMessage } from "@/features/admin/errors";
import { useAdminMovements } from "@/features/admin/movements/hooks";
import { cn } from "@/lib/utils";

const statusOptions: Array<"all" | DocumentationStatus> = ["all", "draft", "published", "archived"];

export function AdminDocumentationClient() {
  const router = useRouter();
  const documentation = useAdminDocumentation();
  const movements = useAdminMovements();
  const createDraft = useCreateDocumentationDraft();
  const [status, setStatus] = useState<"all" | DocumentationStatus>("all");
  const [movementId, setMovementId] = useState("all");
  const [search, setSearch] = useState("");

  const records = useMemo(() => {
    const query = search.trim().toLowerCase();
    return (documentation.data ?? []).filter((record) => {
      const matchesStatus = status === "all" || record.status === status;
      const matchesMovement = movementId === "all" || record.movement_id === movementId;
      const matchesSearch =
        !query ||
        [record.movement.name, record.movement.slug, record.movement.family_key]
          .join(" ")
          .toLowerCase()
          .includes(query);

      return matchesStatus && matchesMovement && matchesSearch;
    });
  }, [documentation.data, movementId, search, status]);

  async function handleCreateDraft() {
    const target = movements.data?.find((movement) => movement.id === movementId);
    if (!target) return;

    try {
      const created = await createDraft.mutateAsync({ movementId: target.id });
      router.push(`/admin/documentation/${created.id}`);
    } catch {
      // The mutation error is rendered beside the action.
    }
  }

  if (documentation.isPending || movements.isPending) {
    return <DocumentationListSkeleton />;
  }

  if (documentation.isError) {
    return <AdminDataError title="Documentation workspace unavailable" message={getAdminErrorMessage(documentation.error)} onRetry={() => void documentation.refetch()} />;
  }

  if (movements.isError) {
    return <AdminDataError title="Movement targets unavailable" message={getAdminErrorMessage(movements.error)} onRetry={() => void movements.refetch()} />;
  }

  return (
    <div className="space-y-5">
      <DashboardSection
        eyebrow="Draft workflow"
        title="Create a documentation draft"
        description="Manual drafts enter the same structured editor and publish action that a future source-agnostic generator can populate."
        aside={<FilePlus2 className="size-5 text-primary" aria-hidden="true" />}
      >
        <div className="flex flex-col gap-3 px-5 py-5 sm:flex-row sm:items-end sm:px-7">
          <label className="block min-w-0 flex-1">
            <span className="mb-2 block text-xs font-medium text-foreground-soft">Target movement</span>
            <Select value={movementId} onValueChange={(value) => setMovementId(value ?? "all")}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Choose a movement" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all" disabled>Choose a movement</SelectItem>
                {movements.data.map((movement) => (
                  <SelectItem key={movement.id} value={movement.id}>{movement.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          <Button type="button" variant="brand" disabled={movementId === "all" || createDraft.isPending} onClick={() => void handleCreateDraft()}>
            <FilePlus2 className="size-4" aria-hidden="true" />
            {createDraft.isPending ? "Creating…" : "Create draft"}
          </Button>
        </div>
        {createDraft.isError ? (
          <p className="border-t border-destructive/20 bg-destructive/5 px-5 py-3 text-sm text-destructive sm:px-7">
            {getAdminErrorMessage(createDraft.error)}
          </p>
        ) : null}
      </DashboardSection>

      <DashboardSection
        eyebrow="Guide library"
        title="Documentation records"
        description="Versions are loaded from each movement's real documentation history endpoint."
        aside={<Filter className="size-5 text-primary" aria-hidden="true" />}
      >
        <div className="grid gap-3 border-b border-border/70 bg-background-alt/25 px-5 py-4 sm:grid-cols-[minmax(180px,1fr)_180px_220px] sm:px-7">
          <label className="relative block">
            <span className="sr-only">Search documentation</span>
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-foreground-faint" aria-hidden="true" />
            <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search movement" className="h-9 pl-9" />
          </label>
          <Select value={status} onValueChange={(value) => setStatus((value ?? "all") as "all" | DocumentationStatus)}>
            <SelectTrigger className="w-full"><SelectValue placeholder="All statuses" /></SelectTrigger>
            <SelectContent>
              {statusOptions.map((option) => <SelectItem key={option} value={option}>{option === "all" ? "All statuses" : option}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={movementId === "all" ? "all" : movementId} onValueChange={(value) => setMovementId(value ?? "all")}>
            <SelectTrigger className="w-full"><SelectValue placeholder="All movements" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All movements</SelectItem>
              {movements.data.map((movement) => <SelectItem key={movement.id} value={movement.id}>{movement.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        {!documentation.data.length ? (
          <DashboardEmptyState icon={<FileText className="size-5" aria-hidden="true" />} title="No documentation records" description="The current movement catalog did not return any documentation versions." />
        ) : !records.length ? (
          <DashboardEmptyState icon={<Search className="size-5" aria-hidden="true" />} title="No matching records" description="Adjust the filters to see another documentation version." />
        ) : (
          <DocumentationTable records={records} />
        )}
      </DashboardSection>
    </div>
  );
}

function DocumentationTable({ records }: { records: AdminDocumentationRecord[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-190 text-left text-sm">
        <thead className="border-b border-border/70 bg-background-alt/35 text-xs text-foreground-soft">
          <tr>
            <th className="px-5 py-3 font-medium sm:px-7">Movement</th>
            <th className="px-5 py-3 font-medium sm:px-7">Version</th>
            <th className="px-5 py-3 font-medium sm:px-7">Status</th>
            <th className="px-5 py-3 font-medium sm:px-7">Updated</th>
            <th className="px-5 py-3 font-medium sm:px-7">Published</th>
            <th className="px-5 py-3 font-medium sm:px-7"><span className="sr-only">Open</span></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/60">
          {records.map((record) => (
            <tr key={record.id}>
              <td className="px-5 py-4 sm:px-7">
                <Link href={`/admin/documentation/${record.id}`} className="font-medium text-foreground hover:text-primary">
                  {record.movement.name}
                </Link>
                <span className="mt-1 block font-mono text-[0.68rem] text-foreground-faint">{record.movement.slug}</span>
              </td>
              <td className="px-5 py-4 font-mono text-xs text-foreground-soft sm:px-7">v{record.version}</td>
              <td className="px-5 py-4 sm:px-7"><DocumentationStatusBadge status={record.status} /></td>
              <td className="px-5 py-4 text-xs text-foreground-soft sm:px-7">{formatDate(record.updated_at)}</td>
              <td className="px-5 py-4 text-xs text-foreground-soft sm:px-7">{record.published_at ? formatDate(record.published_at) : "—"}</td>
              <td className="px-5 py-4 sm:px-7"><Link href={`/admin/documentation/${record.id}`} className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "text-foreground-soft")}>Open</Link></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DocumentationListSkeleton() {
  return <div className="h-96 animate-pulse rounded-[1.6rem] bg-muted/50" />;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(new Date(value));
}
