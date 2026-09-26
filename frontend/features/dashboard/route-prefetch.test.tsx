import { renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";

import { authApiFetch } from "@/lib/auth-api";
import { connectPrivateQueryClient, invalidatePrivateQueries } from "@/lib/private-state";

import { usePrefetchDashboardRoute } from "./route-prefetch";

vi.mock("@/lib/auth-api", () => ({ authApiFetch: vi.fn() }));

function setup() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 30_000 } } });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const { result } = renderHook(() => usePrefetchDashboardRoute(), { wrapper });
  return { queryClient, prefetch: result.current };
}

afterEach(() => vi.clearAllMocks());

describe("dashboard route prefetch", () => {
  it("warms the queries a page reads through the authenticated API", async () => {
    vi.mocked(authApiFetch).mockResolvedValue({ movements: [] });
    const { queryClient, prefetch } = setup();

    prefetch("/dashboard/progress");

    await vi.waitFor(() =>
      expect(queryClient.getQueryData(["progress", "summary"])).toEqual({ movements: [] }),
    );
    expect(authApiFetch).toHaveBeenCalledWith("/progress/summary", expect.anything());
  });

  it("does not refetch fresh data when a link is hovered repeatedly", async () => {
    vi.mocked(authApiFetch).mockResolvedValue([]);
    const { prefetch } = setup();

    prefetch("/dashboard/analyses");
    await vi.waitFor(() => expect(authApiFetch).toHaveBeenCalledTimes(1));
    prefetch("/dashboard/analyses");
    await Promise.resolve();

    expect(authApiFetch).toHaveBeenCalledTimes(1);
  });

  it("throttles queries that always revalidate instead of refetching on every hover", async () => {
    vi.mocked(authApiFetch).mockResolvedValue({ effective_plan: "free" });
    const { prefetch } = setup();

    prefetch("/dashboard/settings");
    await vi.waitFor(() => expect(authApiFetch).toHaveBeenCalledTimes(1));
    prefetch("/dashboard/settings");
    await Promise.resolve();

    expect(authApiFetch).toHaveBeenCalledTimes(1);
  });

  it("ignores links that have no data to warm", () => {
    const { prefetch } = setup();

    prefetch("/dashboard/coach");
    prefetch("/admin/users");

    expect(authApiFetch).not.toHaveBeenCalled();
  });

  it("swallows failed prefetches so hovering never surfaces an error", async () => {
    vi.mocked(authApiFetch).mockRejectedValue(new Error("Your session is unavailable. Sign in again."));
    const { queryClient, prefetch } = setup();

    expect(() => prefetch("/dashboard/profile")).not.toThrow();
    await vi.waitFor(() => expect(authApiFetch).toHaveBeenCalled());
    expect(queryClient.getQueryData(["athlete-profile", "me"])).toBeUndefined();
  });
});

describe("invalidatePrivateQueries", () => {
  it("marks cached private queries stale for code outside React", async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(["library", "plans"], []);
    const disconnect = connectPrivateQueryClient(queryClient);

    invalidatePrivateQueries(["library"]);

    expect(queryClient.getQueryState(["library", "plans"])?.isInvalidated).toBe(true);
    disconnect();
  });

  it("is a no-op when no client is connected", () => {
    expect(() => invalidatePrivateQueries(["library"])).not.toThrow();
  });
});
