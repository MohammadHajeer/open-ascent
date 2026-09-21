import type { EffectivePlan } from "./types";

export type CheckoutReturnState = "success" | "cancelled" | null;

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

