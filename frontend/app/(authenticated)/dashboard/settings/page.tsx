import { ArrowUpRight, Compass, MonitorCog, ShieldCheck, UserRound } from "lucide-react";
import Link from "next/link";

import { DashboardPageHeader } from "@/components/dashboard/dashboard-page-header";
import { DashboardSection } from "@/components/dashboard/dashboard-section";
import { ThemeToggle } from "@/components/shared/theme-toggle";
import { buttonVariants } from "@/components/ui/button";
import { PlanBilling } from "@/features/subscription/plan-billing";
import type { CheckoutReturnState } from "@/features/subscription/presentation";
import { SettingsTourAction } from "@/components/tour/settings-tour-action";

function SettingRow({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean | "true" }>;
  title: string;
  description: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-4 px-5 py-6 sm:flex-nowrap sm:px-7">
      <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary-light text-primary">
        <Icon className="size-[1.125rem]" aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1 basis-56">
        <h3 className="text-sm font-medium">{title}</h3>
        <p className="mt-1 text-xs leading-5 text-foreground-soft">{description}</p>
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

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
          <SettingRow
            icon={Compass}
            title="Workspace walkthrough"
            description="Take another walkthrough of Open Ascent."
            action={<SettingsTourAction />}
          />
        </DashboardSection>
        <DashboardSection eyebrow="Appearance" title="Display preference">
          <SettingRow
            icon={MonitorCog}
            title="Color theme"
            description="Choose light, dark, or your system setting."
            action={<ThemeToggle />}
          />
        </DashboardSection>
        <DashboardSection eyebrow="Account" title="Athlete profile">
          <SettingRow
            icon={UserRound}
            title="Goal, equipment, and starting point"
            description="Review your goal, equipment, availability, and self reported starting point. Your sessions and progress live in the training workspace."
            action={
              <Link href="/dashboard/profile" className={buttonVariants({ variant: "outline" })}>
                Open profile
                <ArrowUpRight className="size-4" aria-hidden="true" />
              </Link>
            }
          />
        </DashboardSection>
        <DashboardSection eyebrow="Security" title="Session">
          <SettingRow
            icon={ShieldCheck}
            title="Signing out"
            description="Use the account menu in the top bar to sign out of this session."
          />
        </DashboardSection>
      </div>
    </div>
  );
}
