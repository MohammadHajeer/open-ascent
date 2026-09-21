import { authApiFetch } from "@/lib/auth-api";

import type {
  MovementDocumentation,
  MovementSafetyContent,
} from "./types";

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
) {
  return authApiFetch<MovementDocumentation>(
    `/movements/documentation/${documentationId}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    },
  );
}

export async function publishDocumentation(documentationId: string) {
  return authApiFetch<MovementDocumentation>(
    `/movements/documentation/${documentationId}/publish`,
    { method: "POST" },
  );
}
