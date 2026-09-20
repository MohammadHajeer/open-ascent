"use client";

import { apiFetch } from "@/lib/api";
import { withBearerToken } from "@/lib/auth-api-headers";
import { createClient } from "@/lib/supabase/client";

export async function authApiFetch<T>(
  path: string,
  options?: RequestInit,
): Promise<T> {
  const { data, error } = await createClient().auth.getSession();
  const accessToken = data.session?.access_token;
  if (error || !accessToken) {
    throw new Error("Your session is unavailable. Sign in again.");
  }

  return apiFetch<T>(path, withBearerToken(options, accessToken));
}
