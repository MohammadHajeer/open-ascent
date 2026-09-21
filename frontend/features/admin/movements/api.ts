import { authApiFetch } from "@/lib/auth-api";

import type { MovementGuide, MovementListItem } from "./types";

export async function fetchAdminMovements() {
  return authApiFetch<MovementListItem[]>("/movements");
}

export async function fetchAdminMovement(slug: string) {
  return authApiFetch<MovementGuide>(`/movements/${encodeURIComponent(slug)}`);
}
