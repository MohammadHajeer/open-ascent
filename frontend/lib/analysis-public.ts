import { queryOptions } from "@tanstack/react-query";

import { apiFetch } from "@/lib/api";
import type { GuestConfig, Movement, MovementGuide } from "@/lib/analysis";

// Public catalog/config is the same for every visitor and changes rarely, so
// it is cached in the browser for a minute and reused across navigations.
const staleTime = 60_000;

export const analysisPublicKeys = {
  movements: ["analysis-public", "movements"] as const,
  guestConfig: ["analysis-public", "guest-config"] as const,
  guide: (slug: string) => ["analysis-public", "guide", slug] as const,
};

export const analysisMovementsQuery = () =>
  queryOptions({
    queryKey: analysisPublicKeys.movements,
    queryFn: () => apiFetch<Movement[]>("/movements"),
    staleTime,
  });

export const analysisGuestConfigQuery = () =>
  queryOptions({
    queryKey: analysisPublicKeys.guestConfig,
    queryFn: () => apiFetch<GuestConfig>("/analyses/guest/config"),
    staleTime,
  });

export const analysisMovementGuideQuery = (slug: string) =>
  queryOptions({
    queryKey: analysisPublicKeys.guide(slug),
    queryFn: () =>
      apiFetch<MovementGuide>(`/movements/${encodeURIComponent(slug)}`),
    staleTime,
  });
