import { cache } from "react";

import { publicApiFetch } from "@/lib/public-api";

import type { MovementGuide } from "./types";

export const getMovementGuide = cache(async (slug: string) => {
  return publicApiFetch<MovementGuide>(
    `/movements/${encodeURIComponent(slug)}`,
  );
});
