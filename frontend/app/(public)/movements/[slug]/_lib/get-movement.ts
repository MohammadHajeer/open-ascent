import { cache } from "react";

import { apiFetch } from "@/lib/api";

import type { MovementGuide } from "./types";

export const getMovementGuide = cache(async (slug: string) => {
  return apiFetch<MovementGuide>(
    `/movements/${encodeURIComponent(slug)}`,
    {
      cache: "no-store",
    },
  );
});
