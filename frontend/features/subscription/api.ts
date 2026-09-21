import { authApiFetch } from "@/lib/auth-api";

import type { CheckoutSession, SubscriptionStatus } from "./types";

export const fetchSubscriptionStatus = () =>
  authApiFetch<SubscriptionStatus>("/subscriptions/me", { cache: "no-store" });

export const beginProCheckout = () =>
  authApiFetch<CheckoutSession>("/subscriptions/checkout", { method: "POST" });

