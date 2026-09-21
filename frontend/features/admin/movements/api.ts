import { authApiFetch } from "@/lib/auth-api";

import type {
  MovementAdminRead,
  MovementCreateInput,
  MovementUpdateInput,
} from "./types";

export async function fetchAdminMovements() {
  return authApiFetch<MovementAdminRead[]>("/movements/admin");
}

export async function fetchAdminMovement(slug: string) {
  return authApiFetch<MovementAdminRead>(
    `/movements/admin/${encodeURIComponent(slug)}`,
  );
}

export async function createAdminMovement(payload: MovementCreateInput) {
  return authApiFetch<MovementAdminRead>("/movements", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function updateAdminMovement(
  movementId: string,
  payload: MovementUpdateInput,
) {
  return authApiFetch<MovementAdminRead>(`/movements/${movementId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}
