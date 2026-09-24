"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { beginProCheckout, cancelProSubscription, fetchLiveCoachAccess, fetchSubscriptionStatus, resumeProSubscription } from "./api";
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

export function useCancelProSubscription() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: cancelProSubscription,
    onSuccess: (status) => {
      queryClient.setQueryData(subscriptionKeys.status(), status);
      void queryClient.invalidateQueries({ queryKey: subscriptionKeys.status() });
    },
  });
}

export function useResumeProSubscription() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: resumeProSubscription,
    onSuccess: (status) => {
      queryClient.setQueryData(subscriptionKeys.status(), status);
      void queryClient.invalidateQueries({ queryKey: subscriptionKeys.status() });
    },
  });
}
