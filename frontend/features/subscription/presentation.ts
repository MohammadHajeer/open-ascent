import type { EffectivePlan } from "./types";

export type CheckoutReturnState = "success" | "cancelled" | null;

// Marketing copy only. The backend entitlement is authoritative for access,
// and the Coach page shows the live allowance it reports.
export const FREE_COACH_DAILY_MESSAGES = 5;

export function canUpgrade(plan: EffectivePlan | undefined) {
  return plan === "free";
}

export function getCheckoutReturnMessage(state: CheckoutReturnState) {
  if (state === "success") {
    return "Checkout completed. Your subscription status will update after payment verification.";
  }
  if (state === "cancelled") {
    return "Checkout was cancelled. Your current plan has not changed.";
  }
  return null;
}

