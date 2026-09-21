"use client";

import { useQuery } from "@tanstack/react-query";

import { fetchAdminMovement, fetchAdminMovements } from "./api";
import { adminMovementKeys } from "./keys";

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
