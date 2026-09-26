import { queryOptions } from "@tanstack/react-query";

import { fetchSubscriptionStatus } from "./api";
import { subscriptionKeys } from "./keys";

// Billing state changes from Stripe webhooks, outside this browser session.
export const subscriptionStatusQuery = () =>
  queryOptions({
    queryKey: subscriptionKeys.status(),
    queryFn: fetchSubscriptionStatus,
    staleTime: 0,
  });
