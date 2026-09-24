import { authApiFetch } from "@/lib/auth-api";

import type { CheckoutSession, LiveCoachAccess, SubscriptionStatus } from "./types";

export const fetchSubscriptionStatus = () =>
  authApiFetch<SubscriptionStatus>("/subscriptions/me", { cache: "no-store" });

export const fetchLiveCoachAccess = () =>
  authApiFetch<LiveCoachAccess>("/subscriptions/live-coach-access", {
    cache: "no-store",
  });

export const beginProCheckout = () =>
  authApiFetch<CheckoutSession>("/subscriptions/checkout", { method: "POST" });

export const cancelProSubscription = () =>
  authApiFetch<SubscriptionStatus>("/subscriptions/cancel", { method: "POST" });

export const resumeProSubscription = () =>
  authApiFetch<SubscriptionStatus>("/subscriptions/resume", { method: "POST" });
