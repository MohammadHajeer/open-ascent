"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

import { createClient } from "@/lib/supabase/client";

export function NavbarAuthAction({
  mobile = false,
  onNavigate,
}: {
  mobile?: boolean;
  onNavigate?: () => void;
}) {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);

  useEffect(() => {
    const supabase = createClient();
    let active = true;
    let authEventReceived = false;

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        authEventReceived = true;
        if (active) setAuthenticated(Boolean(session));
      },
    );

    void supabase.auth.getSession().then(({ data }) => {
      if (active && !authEventReceived) {
        setAuthenticated(Boolean(data.session));
      }
    }).catch(() => {
      if (active && !authEventReceived) setAuthenticated(false);
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  if (authenticated === null) {
    return mobile ? (
      <span aria-hidden="true" className="flex min-h-16 items-center border-b border-border">
        <span className="h-4 w-24 rounded-full bg-border/70" />
      </span>
    ) : (
      <span aria-hidden="true" className="h-4 w-14 rounded-full bg-border/70" />
    );
  }

  const href = authenticated ? "/dashboard" : "/login";
  const label = authenticated ? "Dashboard" : "Sign in";

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
