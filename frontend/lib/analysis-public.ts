import { queryOptions } from "@tanstack/react-query";

import { apiFetch } from "@/lib/api";
import type { GuestConfig, Movement, MovementGuide } from "@/lib/analysis";
import type { AnalysisServiceState } from "@/lib/analysis-progress";

// Public catalog/config is the same for every visitor and changes rarely, so
// it is cached in the browser for a minute and reused across navigations.
const staleTime = 60_000;

export const analysisPublicKeys = {
  movements: ["analysis-public", "movements"] as const,
  guestConfig: ["analysis-public", "guest-config"] as const,
  availability: ["analysis-public", "availability"] as const,
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

// Informational only: the backend re-checks worker health when a new
// analysis is reserved. Polled so an outage (or recovery) shows up while the
// athlete is still choosing a video.
export const analysisAvailabilityQuery = () =>
  queryOptions({
    queryKey: analysisPublicKeys.availability,
    queryFn: async () =>
      (
        await apiFetch<{ state: AnalysisServiceState }>(
          "/analyses/availability",
          { cache: "no-store" },
        )
      ).state,
    staleTime: 0,
    refetchInterval: 15_000,
    retry: false,
  });

export const analysisMovementGuideQuery = (slug: string) =>
  queryOptions({
    queryKey: analysisPublicKeys.guide(slug),
    queryFn: () =>
      apiFetch<MovementGuide>(`/movements/${encodeURIComponent(slug)}`),
    staleTime,
  });
