"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { getAdminErrorMessage } from "@/features/admin/errors";
import { fetchAdminMovements } from "@/features/admin/movements/api";
import { adminMovementKeys } from "@/features/admin/movements/keys";

import {
  createDocumentationDraft,
  createDocumentationDraftFromPublished,
  fetchDocumentationVersions,
  publishDocumentation,
  updateDocumentationDraft,
} from "./api";
import { adminDocumentationKeys } from "./keys";
import type {
  AdminDocumentationRecord,
  MovementSafetyContent,
} from "./types";

async function fetchDocumentationWorkspace(): Promise<AdminDocumentationRecord[]> {
  const movements = await fetchAdminMovements();
  const versions = await Promise.all(
    movements.map(async (movement) => ({
      movement,
      versions: await fetchDocumentationVersions(movement.id),
    })),
  );

  return versions.flatMap(({ movement, versions: movementVersions }) =>
    movementVersions.map((documentation) => ({
      ...documentation,
      movement,
    })),
  );
}

async function fetchDocumentationRecord(id: string) {
  const records = await fetchDocumentationWorkspace();
  return records.find((record) => record.id === id) ?? null;
}

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

export function useAdminDocumentation() {
  return useQuery({
    queryKey: adminDocumentationKeys.lists(),
    queryFn: fetchDocumentationWorkspace,
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
    queryFn: () => fetchDocumentationRecord(id),
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
    }: {
      documentationId: string;
      content: MovementSafetyContent;
    }) => updateDocumentationDraft(documentationId, content),
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
    mutationFn: (documentationId: string) =>
      publishDocumentation(documentationId),
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
