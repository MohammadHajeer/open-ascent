"use client";

import { useEffect, useState } from "react";

import { createClient } from "@/lib/supabase/client";

export type SessionState = "loading" | "authenticated" | "guest";

/**
 * Presentation-only view of the browser session, so public routes can stay
 * statically rendered. It never grants access: the backend authorizes every
 * request from the bearer token.
 */
export function useSessionState(): SessionState {
  const [state, setState] = useState<SessionState>("loading");

  useEffect(() => {
    const supabase = createClient();
    let active = true;
    let authEventReceived = false;

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        authEventReceived = true;
        if (active) setState(session ? "authenticated" : "guest");
      },
    );

    void supabase.auth.getSession().then(({ data }) => {
      if (active && !authEventReceived) {
        setState(data.session ? "authenticated" : "guest");
      }
    }).catch(() => {
      if (active && !authEventReceived) setState("guest");
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  return state;
}
