"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

import { createClient } from "@/lib/supabase/client";

type AuthAction = "sign-in" | "dashboard" | "admin";

export function NavbarAuthAction({
  mobile = false,
  onNavigate,
}: {
  mobile?: boolean;
  onNavigate?: () => void;
}) {
  const [action, setAction] = useState<AuthAction | null>(null);

  useEffect(() => {
    const supabase = createClient();
    let active = true;
    let authEventReceived = false;
    let latestRequest = 0;

    function resolveSession(accessToken: string | null) {
      const request = ++latestRequest;
      if (!accessToken) {
        setAction("sign-in");
        return;
      }

      setAction(null);
      void supabase.auth.getClaims(accessToken).then(({ data, error }) => {
        if (!active || request !== latestRequest) return;
        if (error || !data?.claims) {
          setAction("sign-in");
          return;
        }
        setAction(data.claims.user_role === "admin" ? "admin" : "dashboard");
      }).catch(() => {
        if (active && request === latestRequest) setAction("sign-in");
      });
    }

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        authEventReceived = true;
        if (active) resolveSession(session?.access_token ?? null);
      },
    );

    void supabase.auth.getSession().then(({ data }) => {
      if (active && !authEventReceived) {
        resolveSession(data.session?.access_token ?? null);
      }
    }).catch(() => {
      if (active && !authEventReceived) resolveSession(null);
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  if (action === null) {
    return mobile ? (
      <span aria-hidden="true" className="flex min-h-16 items-center border-b border-border">
        <span className="h-4 w-24 rounded-full bg-border/70" />
      </span>
    ) : (
      <span aria-hidden="true" className="h-4 w-14 rounded-full bg-border/70" />
    );
  }

  const href = action === "admin" ? "/admin" : action === "dashboard" ? "/dashboard" : "/login";
  const label = action === "admin" ? "Admin console" : action === "dashboard" ? "Dashboard" : "Sign in";

  if (mobile) {
    return (
      <Link
        className="flex min-h-16 items-center gap-4 border-b border-border text-lg font-medium tracking-[-0.03em] text-foreground transition-colors hover:text-primary"
        href={href}
        onClick={onNavigate}
      >
        <small className="font-mono text-[0.58rem] tracking-wider text-foreground-faint">04</small>
        {label}
      </Link>
    );
  }

  return (
    <Link
      href={href}
      className="rounded-full px-3 py-2 text-[0.8rem] font-medium text-foreground-soft transition-colors hover:text-foreground"
    >
      {label}
    </Link>
  );
}
