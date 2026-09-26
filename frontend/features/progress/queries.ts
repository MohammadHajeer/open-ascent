import { queryOptions } from "@tanstack/react-query";

import { fetchProgressSummary } from "./api";
import { progressKeys } from "./keys";

export const progressSummaryQuery = () =>
  queryOptions({
    queryKey: progressKeys.summary,
    queryFn: fetchProgressSummary,
  });
