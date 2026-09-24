import { Compass, MonitorCog, ShieldCheck, SlidersHorizontal, UserRound } from "lucide-react";
import Link from "next/link";

import { DashboardPageHeader } from "@/components/dashboard/dashboard-page-header";
import { DashboardSection } from "@/components/dashboard/dashboard-section";
import { ThemeToggle } from "@/components/shared/theme-toggle";
import { PlanBilling } from "@/features/subscription/plan-billing";
import type { CheckoutReturnState } from "@/features/subscription/presentation";
import { SettingsTourAction } from "@/components/tour/settings-tour-action";

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
        description="Review your plan, profile, and workspace preferences."
      />

      <PlanBilling checkoutReturn={checkoutReturn} />

      <div className="grid gap-5 xl:grid-cols-2">
        <DashboardSection eyebrow="Guided tour" title="Explore your workspace">
          <div className="flex flex-wrap items-center gap-4 px-5 py-6 sm:px-7">
            <Compass className="size-5 shrink-0 text-primary" aria-hidden="true" />
            <p className="min-w-0 flex-1 text-sm text-foreground-soft">Take another walkthrough of Open Ascent.</p>
            <SettingsTourAction />
          </div>
        </DashboardSection>
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
              Review your goal, equipment, availability, and self reported starting point in your <Link href="/dashboard/profile" className="font-medium text-primary underline underline-offset-2">athlete profile</Link>.
            </p>
          </div>
        </DashboardSection>

        <DashboardSection eyebrow="Training" title="Preferences">
          <div className="flex gap-4 px-5 py-6 sm:px-7">
            <SlidersHorizontal className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden="true" />
            <p className="text-sm leading-6 text-foreground-soft">
              Your training context is shown in your <Link href="/dashboard/profile" className="font-medium text-primary underline underline-offset-2">profile</Link>. Your sessions and progress are available from the training workspace.
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
