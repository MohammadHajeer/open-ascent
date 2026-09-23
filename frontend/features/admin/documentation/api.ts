import { authApiFetch } from "@/lib/auth-api";

import type {
  AdminDocumentationRecord,
  DocumentationPage,
  MovementDocumentation,
  MovementSafetyContent,
} from "./types";

export type DocumentationFilters = { page: number; status: string; movementId: string; search: string };

export async function fetchAdminDocumentation(filters: DocumentationFilters) {
  const query = new URLSearchParams({ page: String(filters.page), page_size: "20" });
  if (filters.status !== "all") query.set("status", filters.status);
  if (filters.movementId !== "all") query.set("movement_id", filters.movementId);
  if (filters.search.trim()) query.set("q", filters.search.trim());
  return authApiFetch<DocumentationPage>(`/movements/documentation/admin?${query}`);
}

export async function fetchAdminDocumentationDetail(id: string) {
  return authApiFetch<AdminDocumentationRecord>(`/movements/documentation/admin/${encodeURIComponent(id)}`);
}

export async function fetchDocumentationVersions(movementId: string) {
  return authApiFetch<MovementDocumentation[]>(
    `/movements/${movementId}/documentation/versions`,
  );
}

export async function createDocumentationDraft(
  movementId: string,
  content: MovementSafetyContent = {},
) {
  return authApiFetch<MovementDocumentation>(
    `/movements/${movementId}/documentation/draft`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    },
  );
}

export async function createDocumentationDraftFromPublished(movementId: string) {
  return authApiFetch<MovementDocumentation>(
    `/movements/${movementId}/documentation/draft-from-published`,
    { method: "POST" },
  );
}

export async function updateDocumentationDraft(
  documentationId: string,
  content: MovementSafetyContent,
  editRevision: number,
) {
  return authApiFetch<MovementDocumentation>(
    `/movements/documentation/${documentationId}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content, edit_revision: editRevision }),
    },
  );
}

export async function publishDocumentation(documentationId: string, editRevision: number) {
  return authApiFetch<MovementDocumentation>(
    `/movements/documentation/${documentationId}/publish`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ edit_revision: editRevision }) },
  );
}
