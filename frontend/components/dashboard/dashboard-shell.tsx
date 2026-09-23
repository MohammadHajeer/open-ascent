import { TooltipProvider } from "@/components/ui/tooltip";
import { ActiveWorkoutIndicator } from "@/features/workouts/active-workout-indicator";
import { DashboardTour } from "@/components/tour/dashboard-tour";

import type { DashboardMode } from "./dashboard-navigation";
import { DashboardMobileNav } from "./dashboard-mobile-nav";
import { DashboardRail } from "./dashboard-rail";
import { DashboardTopbar } from "./dashboard-topbar";

export function DashboardShell({
  children,
  mode = "user",
}: {
  children: React.ReactNode;
  mode?: DashboardMode;
}) {
  return (
    <TooltipProvider>
      <div className="min-h-dvh bg-background text-foreground">
        <DashboardRail mode={mode} />

        <div className="min-h-dvh lg:pl-24">
          <DashboardTopbar mode={mode} />
          {mode === "user" ? <ActiveWorkoutIndicator /> : null}

          <main className="relative min-h-[calc(100dvh-4.5rem)] overflow-hidden">
            <div
              className="cv-grid cv-grid-radial pointer-events-none absolute inset-x-0 top-0 h-136 opacity-[0.16]"
              aria-hidden="true"
            />

            <div
              className="pointer-events-none absolute top-0 right-[9%] h-44 w-44 rounded-full border border-primary/10 sm:h-64 sm:w-64"
              aria-hidden="true"
            />
            <div
              className="pointer-events-none absolute top-20 right-[4%] h-24 w-24 rounded-full border border-primary/10 sm:h-36 sm:w-36"
              aria-hidden="true"
            />

            <div className="relative mx-auto w-full max-w-[1600px] px-4 pt-6 pb-28 sm:px-6 sm:pt-8 lg:px-8 lg:pt-10 lg:pb-12 xl:px-10">
              {children}
            </div>
          </main>
        </div>

        <DashboardMobileNav mode={mode} />
        {mode === "user" ? <DashboardTour /> : null}
      </div>
    </TooltipProvider>
  );
}
