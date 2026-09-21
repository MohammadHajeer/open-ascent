import { MonitorCog, ShieldCheck, SlidersHorizontal, UserRound } from "lucide-react";

import { DashboardPageHeader } from "@/components/dashboard/dashboard-page-header";
import { DashboardSection } from "@/components/dashboard/dashboard-section";
import { ThemeToggle } from "@/components/shared/theme-toggle";
import { PlanBilling } from "@/features/subscription/plan-billing";
import type { CheckoutReturnState } from "@/features/subscription/presentation";

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ checkout?: string | string[] }>;
}) {
  const checkout = (await searchParams).checkout;
  const checkoutReturn: CheckoutReturnState =
    checkout === "success" || checkout === "cancelled" ? checkout : null;

  return (
    <div className="space-y-8">
      <DashboardPageHeader
        eyebrow="Account settings"
        title="Your workspace."
        description="A quiet place for account and training preferences as they become available."
      />

      <PlanBilling checkoutReturn={checkoutReturn} />

      <div className="grid gap-5 xl:grid-cols-2">
        <DashboardSection eyebrow="Appearance" title="Display preference">
          <div className="flex items-center gap-4 px-5 py-6 sm:px-7">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary-light text-primary">
              <MonitorCog className="size-4.5" aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1">
              <h3 className="text-sm font-medium">Color theme</h3>
              <p className="mt-1 text-xs leading-5 text-foreground-soft">
                Choose light, dark, or your system setting.
              </p>
            </div>
            <ThemeToggle />
          </div>
        </DashboardSection>

        <DashboardSection eyebrow="Account" title="Profile information">
          <div className="flex gap-4 px-5 py-6 sm:px-7">
            <UserRound className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden="true" />
            <p className="text-sm leading-6 text-foreground-soft">
              Your account details will be available here when profile editing is connected.
            </p>
          </div>
        </DashboardSection>

        <DashboardSection eyebrow="Training" title="Preferences">
          <div className="flex gap-4 px-5 py-6 sm:px-7">
            <SlidersHorizontal className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden="true" />
            <p className="text-sm leading-6 text-foreground-soft">
              Training preferences will be managed here when those settings are available.
            </p>
          </div>
        </DashboardSection>

        <DashboardSection eyebrow="Security" title="Session">
          <div className="flex gap-4 px-5 py-6 sm:px-7">
            <ShieldCheck className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden="true" />
            <p className="text-sm leading-6 text-foreground-soft">
              Use the account menu in the top bar to sign out of this session.
            </p>
          </div>
        </DashboardSection>
      </div>
    </div>
  );
}
