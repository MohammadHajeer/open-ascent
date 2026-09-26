import { queryOptions } from "@tanstack/react-query";

import { fetchDashboardContext } from "./api";

export const dashboardKeys = {
  context: ["dashboard", "context"] as const,
};

export const dashboardContextQuery = () =>
  queryOptions({
    queryKey: dashboardKeys.context,
    queryFn: fetchDashboardContext,
  });
