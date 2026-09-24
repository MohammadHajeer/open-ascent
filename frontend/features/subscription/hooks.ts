"use client";

import { useMutation, useQuery } from "@tanstack/react-query";

import { beginProCheckout, fetchLiveCoachAccess, fetchSubscriptionStatus } from "./api";
import { subscriptionKeys } from "./keys";

export function useSubscriptionStatus() {
  return useQuery({
    queryKey: subscriptionKeys.status(),
    queryFn: fetchSubscriptionStatus,
  });
}

export function useLiveCoachAccess() {
  return useQuery({
    queryKey: ["subscription", "live-coach-access"],
    queryFn: fetchLiveCoachAccess,
    staleTime: 0,
  });
}

export function useBeginProCheckout() {
  return useMutation({ mutationFn: beginProCheckout });
}
