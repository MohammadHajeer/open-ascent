import "server-only";

import { apiFetch } from "@/lib/api";
import type { GuestConfig, Movement, MovementGuide } from "@/lib/analysis";

// Public catalog/config changes should appear soon without a frontend deploy.
const publicFetchOptions = { next: { revalidate: 60 } };

export const getAnalysisMovements = () =>
  apiFetch<Movement[]>("/movements", publicFetchOptions);

export const getAnalysisMovementGuide = (slug: string) =>
  apiFetch<MovementGuide>(`/movements/${encodeURIComponent(slug)}`, publicFetchOptions);

export const getAnalysisGuestConfig = () =>
  apiFetch<GuestConfig>("/analyses/guest/config", publicFetchOptions);
