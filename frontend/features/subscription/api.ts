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
