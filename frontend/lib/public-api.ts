import "server-only";

import { apiFetch } from "@/lib/api";

// Public catalog data is identical for every visitor, so routes that read it
// are prerendered and revalidated in the background instead of rendered per
// request. New or edited movement guides appear within this window without a
// frontend deploy.
export const PUBLIC_REVALIDATE_SECONDS = 60;

export const publicApiFetch = <T>(path: string) =>
  apiFetch<T>(path, { next: { revalidate: PUBLIC_REVALIDATE_SECONDS } });

const isProductionBuild = () =>
  process.env.NEXT_PHASE === "phase-production-build";

/**
 * Like `publicApiFetch`, but a build without a reachable API returns `fallback`
 * instead of failing, so `pnpm build` does not depend on the backend running.
 * The prerendered page is then stale from the start and regenerates from the
 * live API on the first request after the revalidate window. At runtime errors
 * still throw, so a backend outage keeps serving the last good cached page
 * instead of replacing it with the fallback.
 */
export async function publicApiFetchOr<T, F>(path: string, fallback: F): Promise<T | F> {
  try {
    return await publicApiFetch<T>(path);
  } catch (error) {
    if (isProductionBuild()) return fallback;
    throw error;
  }
}
