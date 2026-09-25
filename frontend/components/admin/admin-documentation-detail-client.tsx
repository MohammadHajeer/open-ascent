"use client";

import Link from "next/link";
import { ArrowLeft, FileText, GitBranch, ShieldCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { DashboardEmptyState } from "@/components/dashboard/dashboard-empty-state";
import { DashboardSection } from "@/components/dashboard/dashboard-section";
import { AdminDataError } from "@/components/admin/admin-movements-client";
import { DocumentationDetailSkeleton } from "@/components/admin/admin-skeletons";
import { DocumentationEditor } from "@/components/admin/documentation-editor";
import { DocumentationStatusBadge } from "@/components/admin/documentation-status-badge";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  useAdminDocumentationDetail,
  useCreateDocumentationDraftFromPublished,
  usePublishDocumentation,
  useUpdateDocumentationDraft,
} from "@/features/admin/documentation/hooks";
import { getAdminErrorMessage } from "@/features/admin/errors";

type EditorContent = Parameters<NonNullable<React.ComponentProps<typeof DocumentationEditor>["onPublish"]>>[0];

export function AdminDocumentationDetailClient({ id }: { id: string }) {
  const router = useRouter();
  const [pendingPublish, setPendingPublish] = useState<EditorContent | null>(null);
  const documentation = useAdminDocumentationDetail(id);
  const updateDraft = useUpdateDocumentationDraft();
  const publish = usePublishDocumentation();
  const createReplacement = useCreateDocumentationDraftFromPublished();

  async function handleSave(content: Parameters<NonNullable<React.ComponentProps<typeof DocumentationEditor>["onSave"]>>[0]) {
    try {
      if (!documentation.data) return;
      await updateDraft.mutateAsync({ documentationId: id, content, editRevision: documentation.data.edit_revision });
    } catch {
      // The mutation error is rendered below the editor.
    }
  }

  function handlePublish(content: EditorContent) {
    if (!documentation.data) return;
    setPendingPublish(content);
  }

  async function confirmPublish() {
    const content = pendingPublish;
    setPendingPublish(null);
    if (!documentation.data || !content) return;

    try {
      const saved = await updateDraft.mutateAsync({ documentationId: id, content, editRevision: documentation.data.edit_revision });
      await publish.mutateAsync({ documentationId: id, editRevision: saved.edit_revision });
    } catch {
      // The mutation error is rendered below the editor.
    }
  }

  async function handleCreateReplacement() {
    if (!documentation.data) return;

    try {
      const created = await createReplacement.mutateAsync(documentation.data.movement_id);
      router.push(`/admin/documentation/${created.id}`);
    } catch {
      // The mutation error is rendered beside the action.
    }
  }

  if (documentation.isPending) {
    return <DocumentationDetailSkeleton />;
  }

  if (documentation.isError) {
    return <AdminDataError title="Documentation record unavailable" message={getAdminErrorMessage(documentation.error)} onRetry={() => void documentation.refetch()} />;
  }

  if (!documentation.data) {
    return <DashboardEmptyState icon={<FileText className="size-5" aria-hidden="true" />} title="Documentation record not found" description="This version is not available through the current admin documentation endpoints." />;
  }

  const record = documentation.data;
  const readOnly = record.status !== "draft";
  const mutationError = updateDraft.error ?? publish.error ?? createReplacement.error;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link href="/admin/documentation" className={buttonVariants({ variant: "outline" })}>
          <ArrowLeft className="size-4" aria-hidden="true" />
          All documentation
        </Link>
        {record.status === "published" ? (
          <Button type="button" variant="brand" disabled={createReplacement.isPending} onClick={() => void handleCreateReplacement()}>
            <GitBranch className="size-4" aria-hidden="true" />
            {createReplacement.isPending ? "Creating…" : "Create replacement draft"}
          </Button>
        ) : null}
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.5fr)_minmax(280px,0.7fr)]">
        <DashboardSection
          eyebrow={`Guide content / Version ${record.version}`}
          title={record.movement.name}
          description={readOnly ? "This version is immutable under the backend documentation lifecycle." : "Edit the structured safety content, save the draft, then publish it manually when complete."}
          aside={<DocumentationStatusBadge status={record.status} />}
        >
          <DocumentationEditor
            key={`${record.id}-${record.edit_revision}`}
            initialContent={record.content}
            readOnly={readOnly}
            saving={updateDraft.isPending || publish.isPending}
            onSave={readOnly ? undefined : handleSave}
            onPublish={readOnly ? undefined : handlePublish}
          />
          {mutationError ? <div className="flex flex-wrap items-center gap-3 border-t border-destructive/20 bg-destructive/5 px-5 py-3 text-sm text-destructive sm:px-7"><span>{getAdminErrorMessage(mutationError)}</span><Button type="button" variant="outline" size="sm" onClick={() => { updateDraft.reset(); publish.reset(); void documentation.refetch(); }}>Reload version</Button></div> : null}
        </DashboardSection>

        <div className="space-y-5">
          <DashboardSection eyebrow="Safety" title="Structured guidance">
            <div className="flex gap-3 px-5 py-6 sm:px-7">
              <ShieldCheck className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden="true" />
              <p className="text-sm leading-6 text-foreground-soft">
                Publishing validates the complete safety content on the backend. Drafts may remain intentionally incomplete while they are being edited.
              </p>
            </div>
          </DashboardSection>
          <DashboardSection eyebrow="Version metadata" title="Publication record">
            <dl className="divide-y divide-border/70 text-sm">
              <Metadata label="Status" value={<DocumentationStatusBadge status={record.status} />} />
              <Metadata label="Revision" value={`Edit ${record.edit_revision}`} />
              <Metadata label="Updated" value={formatDate(record.updated_at)} />
              <Metadata label="Published" value={record.published_at ? formatDate(record.published_at) : "Not published"} />
            </dl>
          </DashboardSection>
          {record.status === "archived" ? (
            <p className="rounded-[1.2rem] border border-border/75 bg-background-alt/55 px-5 py-4 text-xs leading-5 text-foreground-soft sm:px-7">
              Archived versions remain available for reference and cannot be edited. The backend does not expose an explicit archive action; replacement publication performs archiving automatically.
            </p>
          ) : null}
        </div>
      </div>

      <AlertDialog open={pendingPublish !== null} onOpenChange={(open) => { if (!open) setPendingPublish(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Publish this documentation version?</AlertDialogTitle>
            <AlertDialogDescription>
              The existing published version may be archived and replaced.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <Button variant="brand" onClick={() => void confirmPublish()}>Publish version</Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function Metadata({ label, value }: { label: string; value: React.ReactNode }) {
  return <div className="flex items-center justify-between gap-3 px-5 py-3.5 sm:px-7"><dt className="text-foreground-soft">{label}</dt><dd>{value}</dd></div>;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}
