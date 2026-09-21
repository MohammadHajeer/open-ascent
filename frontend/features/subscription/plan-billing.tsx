"use client";

import { ArrowUpRight, Check, CircleGauge, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

import { DashboardSection } from "@/components/dashboard/dashboard-section";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

import { useBeginProCheckout, useSubscriptionStatus } from "./hooks";
import {
  canUpgrade,
  getCheckoutReturnMessage,
  type CheckoutReturnState,
} from "./presentation";

const freeAccess = [
  "Uploaded video analysis with plan limits",
  "Persistent analysis history and basic progress tracking",
  "Movement library and documentation",
  "Safety guidance on every plan",
];

const proAccess = [
  "Higher uploaded-analysis and AI Coach allowances",
  "Live Coach when available",
  "Adaptive training plans and advanced progress insights",
  "Safety guidance on every plan",
];

export function PlanBilling({
  checkoutReturn,
}: {
  checkoutReturn: CheckoutReturnState;
}) {
  const status = useSubscriptionStatus();
  const checkout = useBeginProCheckout();
  const message = getCheckoutReturnMessage(checkoutReturn);
  const plan = status.data?.effective_plan;
  const features = plan === "pro" ? proAccess : freeAccess;

  async function handleUpgrade() {
    try {
      const session = await checkout.mutateAsync();
      window.location.assign(session.url);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Checkout could not be started. Please try again.",
      );
    }
  }

  return (
    <DashboardSection
      eyebrow="Plan & billing"
      title="Your coaching access"
      description="Your plan is resolved from verified subscription state."
      aside={
        <Badge variant={plan === "pro" ? "default" : "secondary"}>
          {status.isPending ? "Checking plan" : plan === "pro" ? "Pro" : "Free"}
        </Badge>
      }
    >
      <div className="space-y-6 px-5 py-6 sm:px-7">
        {message ? (
          <Alert>
            <CircleGauge aria-hidden="true" />
            <AlertTitle>
              {checkoutReturn === "success" ? "Verification pending" : "No changes made"}
            </AlertTitle>
            <AlertDescription>{message}</AlertDescription>
          </Alert>
        ) : null}

        {status.isError ? (
          <Alert variant="destructive">
            <AlertTitle>Plan status unavailable</AlertTitle>
            <AlertDescription>
              We could not verify your plan. Refresh the page before trying again.
            </AlertDescription>
          </Alert>
        ) : (
          <>
            <div>
              <p className="font-mono text-[0.58rem] tracking-[0.12em] text-foreground-faint uppercase">
                Current plan
              </p>
              <p className="mt-2 text-3xl font-medium tracking-[-0.045em]">
                {status.isPending ? "—" : plan === "pro" ? "Pro" : "Free"}
              </p>
            </div>

            <ul className="grid gap-3 sm:grid-cols-2">
              {features.map((feature) => (
                <li
                  className="flex items-start gap-3 text-sm leading-6 text-foreground-soft"
                  key={feature}
                >
                  <span className="mt-1 grid size-5 shrink-0 place-items-center rounded-full bg-primary-light text-primary">
                    {feature.startsWith("Safety") ? (
                      <ShieldCheck className="size-3" aria-hidden="true" />
                    ) : (
                      <Check className="size-3" aria-hidden="true" />
                    )}
                  </span>
                  {feature}
                </li>
              ))}
            </ul>

            {canUpgrade(plan) ? (
              <div className="flex flex-wrap items-center gap-4 border-t border-border pt-6">
                <Button
                  variant="brand"
                  size="lg"
                  disabled={checkout.isPending}
                  onClick={handleUpgrade}
                >
                  {checkout.isPending ? "Opening secure checkout…" : "Upgrade to Pro"}
                  {!checkout.isPending ? (
                    <ArrowUpRight className="size-4" aria-hidden="true" />
                  ) : null}
                </Button>
                <p className="max-w-md text-xs leading-5 text-foreground-faint">
                  Test mode only. Checkout does not activate Pro until payment is
                  verified.
                </p>
              </div>
            ) : null}
          </>
        )}
      </div>
    </DashboardSection>
  );
}

