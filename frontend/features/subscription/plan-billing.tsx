"use client";

import { ArrowUpRight, Check, CircleGauge, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

import { DashboardSection } from "@/components/dashboard/dashboard-section";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

import { useBeginProCheckout, useCancelProSubscription, useResumeProSubscription, useSubscriptionStatus } from "./hooks";
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
  const cancellation = useCancelProSubscription();
  const resumption = useResumeProSubscription();
  const message = getCheckoutReturnMessage(checkoutReturn);
  const plan = status.data?.effective_plan;
  const checkoutVerified = checkoutReturn === "success" && plan === "pro";
  const features = plan === "pro" ? proAccess : freeAccess;
  const price = status.data?.pro_price;
  const formattedPrice = price
    ? new Intl.NumberFormat("en-US", { style: "currency", currency: price.currency }).format(price.unit_amount / 100)
    : null;
  const periodEnd = status.data?.current_period_end
    ? new Intl.DateTimeFormat("en-US", { dateStyle: "long" }).format(new Date(status.data.current_period_end))
    : null;
  const inactiveCopy: Record<string, string> = {
    past_due: "A payment needs attention. Pro access is paused.",
    unpaid: "Payment is outstanding. Pro access is paused.",
    paused: "Your Pro subscription is paused.",
    incomplete: "Your Pro payment is still incomplete.",
    incomplete_expired: "Your Pro payment was not completed.",
    canceled: "Your previous Pro subscription has ended.",
    trialing: "Your Pro subscription is awaiting activation.",
  };
  const inactiveStatus = status.data?.subscription_status
    ? inactiveCopy[status.data.subscription_status]
    : null;

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

  async function handleCancel() {
    try {
      await cancellation.mutateAsync();
      toast.success("Cancellation scheduled. Your Pro access remains active through this billing period.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Cancellation could not be scheduled. Please try again.");
    }
  }

  async function handleResume() {
    try {
      await resumption.mutateAsync();
      toast.success("Your Pro plan will renew at the end of this billing period.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not keep your plan. Please try again.");
    }
  }

  return (
    <DashboardSection
      eyebrow="Plan & billing"
      title="Your coaching access"
      description="Review your plan and manage your monthly subscription."
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
              {checkoutVerified ? "Pro active" : checkoutReturn === "success" ? "Verification pending" : "No changes made"}
            </AlertTitle>
            <AlertDescription>{checkoutVerified ? "Your payment has been verified and Pro access is active." : message}</AlertDescription>
          </Alert>
        ) : null}

        {status.isPending ? (
          <p className="text-sm text-foreground-soft">Checking your plan and current price…</p>
        ) : status.isError ? (
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
              {formattedPrice ? (
                <p className="mt-2 text-sm text-foreground-soft">
                  {plan === "pro" ? "Open Ascent Pro" : "Upgrade to Open Ascent Pro"} — {formattedPrice} / month
                </p>
              ) : null}
              {plan === "pro" ? (
                <div className="mt-4 space-y-1 text-sm text-foreground-soft">
                  <p>Status: {status.data?.cancel_at_period_end ? "Cancellation scheduled" : "Active"}</p>
                  {periodEnd ? <p>{status.data?.cancel_at_period_end
                    ? `Your Pro plan will remain active until ${periodEnd}.`
                    : `Next renewal: ${periodEnd}.`}</p> : null}
                </div>
              ) : null}
              {plan === "free" && inactiveStatus ? <p className="mt-3 text-sm text-foreground-soft">{inactiveStatus}</p> : null}
            </div>

            <div className="grid gap-3 rounded-xl border border-border p-4 text-sm sm:grid-cols-2">
              <div><p className="font-medium">Free</p><p className="mt-1 text-foreground-soft">Workout history, progress, movement guides, and safety guidance.</p></div>
              <div><p className="font-medium">Pro · {formattedPrice ?? "monthly"}</p><p className="mt-1 text-foreground-soft">Higher Coach and analysis allowances, adaptive plans, and Live Coach access.</p></div>
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
                  Checkout opens securely. Your Pro access begins after payment is verified.
                </p>
              </div>
            ) : null}
            {status.data?.can_cancel ? (
              <div className="border-t border-border pt-6">
                <Button variant="outline" disabled={cancellation.isPending} onClick={handleCancel}>
                  {cancellation.isPending ? "Scheduling cancellation…" : "Cancel subscription"}
                </Button>
                <p className="mt-2 text-xs leading-5 text-foreground-faint">Your Pro benefits continue until the end of the current billing period.</p>
              </div>
            ) : null}
            {plan === "pro" && status.data?.cancel_at_period_end ? (
              <div className="border-t border-border pt-6">
                <Button variant="outline" disabled={resumption.isPending} onClick={handleResume}>
                  {resumption.isPending ? "Keeping your plan…" : "Keep Pro plan"}
                </Button>
              </div>
            ) : null}
          </>
        )}
      </div>
    </DashboardSection>
  );
}
