"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { getAdminErrorMessage } from "@/features/admin/errors";
import { adminMovementKeys } from "@/features/admin/movements/keys";

import {
  createDocumentationDraft,
  createDocumentationDraftFromPublished,
  fetchAdminDocumentation,
  fetchAdminDocumentationDetail,
  fetchDocumentationVersions,
  publishDocumentation,
  updateDocumentationDraft,
} from "./api";
import { adminDocumentationKeys } from "./keys";
import type {
  MovementSafetyContent,
} from "./types";
import type { DocumentationFilters } from "./api";

function invalidateDocumentationQueries(
  queryClient: ReturnType<typeof useQueryClient>,
  movementId: string,
  documentationId?: string,
) {
  void queryClient.invalidateQueries({ queryKey: adminDocumentationKeys.all });
  void queryClient.invalidateQueries({
    queryKey: adminDocumentationKeys.byMovement(movementId),
  });

  if (documentationId) {
    void queryClient.invalidateQueries({
      queryKey: adminDocumentationKeys.detail(documentationId),
    });
  }
}

export function useAdminDocumentation(filters: DocumentationFilters) {
  return useQuery({
    queryKey: [...adminDocumentationKeys.lists(), filters],
    queryFn: () => fetchAdminDocumentation(filters),
  });
}

export function useAdminDocumentationByMovement(movementId: string) {
  return useQuery({
    queryKey: adminDocumentationKeys.byMovement(movementId),
    queryFn: () => fetchDocumentationVersions(movementId),
    enabled: Boolean(movementId),
  });
}

export function useAdminDocumentationDetail(id: string) {
  return useQuery({
    queryKey: adminDocumentationKeys.detail(id),
    queryFn: () => fetchAdminDocumentationDetail(id),
    enabled: Boolean(id),
  });
}

export function useCreateDocumentationDraft() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      movementId,
      content = {},
    }: {
      movementId: string;
      content?: MovementSafetyContent;
    }) => createDocumentationDraft(movementId, content),
    onSuccess: (documentation) => {
      invalidateDocumentationQueries(queryClient, documentation.movement_id);
      toast.success("Draft created");
    },
    onError: (error) => toast.error(getAdminErrorMessage(error)),
  });
}

export function useCreateDocumentationDraftFromPublished() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (movementId: string) =>
      createDocumentationDraftFromPublished(movementId),
    onSuccess: (documentation) => {
      invalidateDocumentationQueries(queryClient, documentation.movement_id);
      toast.success("Replacement draft created");
    },
    onError: (error) => toast.error(getAdminErrorMessage(error)),
  });
}

export function useUpdateDocumentationDraft() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      documentationId,
      content,
      editRevision,
    }: {
      documentationId: string;
      content: MovementSafetyContent;
      editRevision: number;
    }) => updateDocumentationDraft(documentationId, content, editRevision),
    onSuccess: (documentation) => {
      invalidateDocumentationQueries(
        queryClient,
        documentation.movement_id,
        documentation.id,
      );
      toast.success("Draft saved");
    },
    onError: (error) => toast.error(getAdminErrorMessage(error)),
  });
}

export function usePublishDocumentation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ documentationId, editRevision }: { documentationId: string; editRevision: number }) =>
      publishDocumentation(documentationId, editRevision),
    onSuccess: (documentation) => {
      invalidateDocumentationQueries(
        queryClient,
        documentation.movement_id,
        documentation.id,
      );
      void queryClient.invalidateQueries({ queryKey: adminMovementKeys.all });
      toast.success("Documentation published");
    },
    onError: (error) => toast.error(getAdminErrorMessage(error)),
  });
}
