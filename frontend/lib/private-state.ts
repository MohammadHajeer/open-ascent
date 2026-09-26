import type { QueryClient } from "@tanstack/react-query";

type PrivateStreamCleanup = () => void | Promise<void>;

const privateStreamCleanups = new Set<PrivateStreamCleanup>();
let activeQueryClient: QueryClient | null = null;

export function connectPrivateQueryClient(queryClient: QueryClient) {
  activeQueryClient = queryClient;

  return () => {
    if (activeQueryClient === queryClient) activeQueryClient = null;
  };
}

/** Marks cached private queries stale from code that has no React context. */
export function invalidatePrivateQueries(...queryKeys: readonly (readonly unknown[])[]) {
  for (const queryKey of queryKeys) {
    void activeQueryClient?.invalidateQueries({ queryKey });
  }
}

export function registerPrivateStreamCleanup(cleanup: PrivateStreamCleanup) {
  privateStreamCleanups.add(cleanup);

  return () => {
    privateStreamCleanups.delete(cleanup);
  };
}

export async function clearPrivateAuthState(queryClient = activeQueryClient) {
  const cleanups = [...privateStreamCleanups];
  privateStreamCleanups.clear();

  await Promise.allSettled(cleanups.map((cleanup) => cleanup()));
  queryClient?.clear();
}
