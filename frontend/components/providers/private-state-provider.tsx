"use client";

import { useEffect, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { createClient } from "@/lib/supabase/client";
import {
  clearPrivateAuthState,
  connectPrivateQueryClient,
} from "@/lib/private-state";

export function PrivateStateProvider({ children }: { children: React.ReactNode }) {
  // One client for the whole app so cached data survives route changes. A short
  // default staleTime avoids refetching on quick back-and-forth navigation;
  // queries whose data changes outside this tab set staleTime: 0 themselves,
  // and admin consoles (operations, moderation) always revalidate.
  const [queryClient] = useState(() => {
    const client = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000 } } });
    client.setQueryDefaults(["admin"], { staleTime: 0 });
    return client;
  });

  useEffect(() => {
    const supabase = createClient();
    const disconnectQueryClient = connectPrivateQueryClient(queryClient);
    let currentUserId: string | null = null;
    let hasResolvedInitialSession = false;
    let active = true;

    function handleSession(userId: string | null) {
      if (!hasResolvedInitialSession) {
        currentUserId = userId;
        hasResolvedInitialSession = true;
        return;
      }

      if (currentUserId !== userId) {
        currentUserId = userId;
        void clearPrivateAuthState(queryClient);
      }
    }

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (active) handleSession(session?.user?.id ?? null);
    });

    void supabase.auth
      .getSession()
      .then(({ data }) => {
        if (active) handleSession(data.session?.user?.id ?? null);
      })
      .catch(() => {
        if (active) handleSession(null);
      });

    return () => {
      active = false;
      subscription.unsubscribe();
      disconnectQueryClient();
    };
  }, [queryClient]);

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
