import { queryOptions } from "@tanstack/react-query";

import { getGenerationOptions, getSavedPlan, listSavedPlans } from "./api";

export const libraryKeys = {
  all: ["library"] as const,
  plans: ["library", "plans"] as const,
  plan: (planId: string) => ["library", "plan", planId] as const,
  generationOptions: ["library", "generation-options"] as const,
};

export const savedPlansQuery = () =>
  queryOptions({ queryKey: libraryKeys.plans, queryFn: listSavedPlans });

export const savedPlanQuery = (planId: string) =>
  queryOptions({
    queryKey: libraryKeys.plan(planId),
    queryFn: () => getSavedPlan(planId),
  });

// Plan allowance also changes from the AI Coach page, so always revalidate.
export const generationOptionsQuery = () =>
  queryOptions({
    queryKey: libraryKeys.generationOptions,
    queryFn: getGenerationOptions,
    staleTime: 0,
  });
