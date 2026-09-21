"use client";

import { useMutation, useQuery } from "@tanstack/react-query";

import { beginProCheckout, fetchSubscriptionStatus } from "./api";
import { subscriptionKeys } from "./keys";

export function useSubscriptionStatus() {
  return useQuery({
    queryKey: subscriptionKeys.status(),
    queryFn: fetchSubscriptionStatus,
  });
}

export function useBeginProCheckout() {
  return useMutation({ mutationFn: beginProCheckout });
}

