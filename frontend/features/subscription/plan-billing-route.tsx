"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";

import { PlanBilling } from "./plan-billing";
import type { CheckoutReturnState } from "./presentation";

function PlanBillingFromUrl() {
  const values = useSearchParams().getAll("checkout");
  const checkout = values.length === 1 ? values[0] : null;
  const checkoutReturn: CheckoutReturnState =
    checkout === "success" || checkout === "cancelled" ? checkout : null;

  return <PlanBilling checkoutReturn={checkoutReturn} />;
}

/**
 * Reads the Stripe return flag in the browser so the settings route can stay a
 * static shell. Plan state itself comes from the authenticated API.
 */
export function PlanBillingRoute() {
  return (
    <Suspense fallback={<PlanBilling checkoutReturn={null} />}>
      <PlanBillingFromUrl />
    </Suspense>
  );
}
