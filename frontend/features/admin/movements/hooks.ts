"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { toast } from "sonner";

import { getAdminErrorMessage } from "@/features/admin/errors";
import { adminDocumentationKeys } from "@/features/admin/documentation/keys";

import {
  createAdminMovement,
  fetchAdminMovement,
  fetchAdminMovements,
  updateAdminMovement,
} from "./api";
import { adminMovementKeys } from "./keys";
import type { MovementCreateInput, MovementUpdateInput } from "./types";

export function useAdminMovements() {
  return useQuery({
    queryKey: adminMovementKeys.all,
    queryFn: fetchAdminMovements,
  });
}

export function useAdminMovement(slug: string) {
  return useQuery({
    queryKey: adminMovementKeys.detail(slug),
    queryFn: () => fetchAdminMovement(slug),
    enabled: Boolean(slug),
  });
}

export function useCreateAdminMovement() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: MovementCreateInput) => createAdminMovement(payload),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: adminMovementKeys.all });
      toast.success("Movement created");
    },
    onError: (error) => toast.error(getAdminErrorMessage(error)),
  });
}

export function useUpdateAdminMovement() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      movementId,
      payload,
    }: {
      movementId: string;
      slug: string;
      payload: MovementUpdateInput;
    }) => updateAdminMovement(movementId, payload),
    onSuccess: (movement, variables) => {
      void queryClient.invalidateQueries({ queryKey: adminMovementKeys.all });
      void queryClient.invalidateQueries({
        queryKey: adminDocumentationKeys.all,
      });
      void queryClient.invalidateQueries({
        queryKey: adminMovementKeys.detail(variables.slug),
      });
      if (movement.slug !== variables.slug) {
        void queryClient.invalidateQueries({
          queryKey: adminMovementKeys.detail(movement.slug),
        });
      }
      toast.success("Movement updated");
    },
    onError: (error) => toast.error(getAdminErrorMessage(error)),
  });
}
