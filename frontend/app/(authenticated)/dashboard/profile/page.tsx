import { Activity, ClipboardList, Target, UserRound } from "lucide-react";

import { DashboardPageHeader } from "@/components/dashboard/dashboard-page-header";
import { DashboardSection } from "@/components/dashboard/dashboard-section";

const profileAreas = [
  {
    label: "Profile identity",
    title: "Display name",
    description: "Your name in the training workspace.",
    icon: UserRound,
  },
  {
    label: "Training context",
    title: "Coaching context",
    description: "Goals, experience, and the conditions you train in.",
    icon: Target,
  },
  {
    label: "Starting record",
    title: "Initial assessment",
    description: "Your self-reported starting point from onboarding.",
    icon: ClipboardList,
  },
  {
    label: "Current direction",
    title: "Athlete state",
    description: "Provisional training context derived from your information.",
    icon: Activity,
  },
];

export default function ProfilePage() {
  return (
    <div className="space-y-8">
      <DashboardPageHeader
        eyebrow="Athlete profile"
        title="Your starting point."
        description="The context behind your training and movement analyses."
      />

      <DashboardSection
        eyebrow="Profile record"
        title="Athlete information"
        description="Your saved profile will appear here when the private profile view is connected."
      >
        <div className="grid md:grid-cols-2">
          {profileAreas.map(({ label, title, description, icon: Icon }, index) => (
            <div
              key={title}
              className={`min-h-48 p-6 sm:p-7 ${index < 3 ? "border-b border-border/75" : ""} ${index % 2 === 0 ? "md:border-r md:border-border/75" : ""} ${index === 2 ? "md:border-b-0" : ""}`}
            >
              <div className="flex items-start justify-between gap-4">
                <span className="font-mono text-[0.56rem] font-semibold tracking-[0.13em] text-primary uppercase">
                  {label}
                </span>
                <Icon className="size-4 text-foreground-faint" aria-hidden="true" />
              </div>
              <h3 className="mt-5 text-lg font-medium tracking-[-0.025em]">
                {title}
              </h3>
              <p className="mt-1 text-sm leading-6 text-foreground-soft">
                {description}
              </p>
              <p className="mt-5 text-xs text-foreground-faint">
                Saved information will appear here.
              </p>
            </div>
          ))}
        </div>
      </DashboardSection>
    </div>
  );
}
