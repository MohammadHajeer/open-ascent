import { queryOptions } from "@tanstack/react-query";

import { authApiFetch } from "@/lib/auth-api";

import type { AthleteProfile } from "./types";

export const fetchProfile = () =>
  authApiFetch<AthleteProfile>("/athlete-profile/me", { cache: "no-store" });

export const athleteProfileQuery = () =>
  queryOptions({
    queryKey: ["athlete-profile", "me"] as const,
    queryFn: fetchProfile,
  });
