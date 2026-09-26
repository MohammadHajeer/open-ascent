"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  Bot,
  BookOpenText,
  ChartNoAxesCombined,
  ClipboardList,
  CreditCard,
  Dumbbell,
  FileText,
  Library,
  ScanLine,
  Settings,
  TrendingUp,
  UserRound,
  Users,
} from "lucide-react";

import { BrandLogo } from "@/components/brand/brand-logo";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { usePrefetchDashboardRoute } from "@/features/dashboard/route-prefetch";
import { cn } from "@/lib/utils";

import {
  getNavigation,
  isNavigationItemActive,
  type DashboardMode,
  type DashboardNavIcon,
} from "./dashboard-navigation";

const iconMap = {
  overview: ChartNoAxesCombined,
  train: Dumbbell,
  progress: TrendingUp,
  coach: Bot,
  library: Library,
  analyses: Activity,
  analyze: ScanLine,
  profile: UserRound,
  settings: Settings,
  movements: Dumbbell,
  documentation: FileText,
  users: Users,
  usage: CreditCard,
  plans: ClipboardList,
} satisfies Record<DashboardNavIcon, React.ComponentType<{ className?: string }>>;

export function DashboardRail({ mode }: { mode: DashboardMode }) {
  const pathname = usePathname();
  const prefetchRoute = usePrefetchDashboardRoute();
  const navigation = getNavigation(mode);

  const mainItems =
    mode === "user"
      ? navigation.filter(
          (item) => item.icon !== "profile" && item.icon !== "settings",
        )
      : navigation;

  const utilityItems =
    mode === "user"
      ? navigation.filter(
          (item) => item.icon === "profile" || item.icon === "settings",
        )
      : [];

  return (
    <aside className="fixed inset-y-3 left-3 z-40 hidden w-18 lg:block">
      <div className="flex h-full flex-col items-center rounded-[1.6rem] border border-border/80 bg-card/95 px-2.5 py-3 shadow-[0_20px_60px_rgba(28,28,26,0.05)] backdrop-blur-md dark:shadow-none">
        <Tooltip>
          <TooltipTrigger
            render={
              <Link
                href={mode === "admin" ? "/admin" : "/dashboard"}
                className="grid size-11 place-items-center rounded-2xl outline-none transition-transform hover:scale-[1.03] focus-visible:ring-2 focus-visible:ring-ring"
                aria-label={mode === "admin" ? "Admin overview" : "Dashboard"}
              />
            }
          >
            <BrandLogo
              alt=""
              variant="dashboard"
              className="size-10 rounded-full"
              sizes="40px"
            />
          </TooltipTrigger>
          <TooltipContent side="right">
            {mode === "admin" ? "Admin console" : "Open Ascent"}
          </TooltipContent>
        </Tooltip>

        <div className="mt-1 flex w-full justify-center">
          <span className="h-px w-7 bg-border" />
        </div>

        <nav
          className="mt-4 flex flex-1 flex-col items-center gap-2"
          aria-label={mode === "admin" ? "Admin navigation" : "Dashboard navigation"}
        >
          {mainItems.map((item) => {
            const Icon = iconMap[item.icon];
            const active = isNavigationItemActive(pathname, item);

            return (
              <Tooltip key={item.href}>
                <TooltipTrigger
                  render={
                    <Link
                      href={item.href}
                      onPointerEnter={() => prefetchRoute(item.href)}
                      onFocus={() => prefetchRoute(item.href)}
                      aria-label={item.label}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "group relative grid size-11 place-items-center rounded-2xl text-foreground-faint outline-none transition-all hover:bg-primary-light hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
                        active &&
                          "bg-primary-light text-primary shadow-[inset_0_0_0_1px_var(--border)]",
                        item.emphasis &&
                          !active &&
                          "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground",
                      )}
                    />
                  }
                >
                  <Icon className="size-[1.15rem]" aria-hidden="true" />
                  {active ? (
                    <span
                      className="absolute -left-3 h-5 w-1 rounded-r-full bg-primary"
                      aria-hidden="true"
                    />
                  ) : null}
                </TooltipTrigger>
                <TooltipContent side="right">{item.label}</TooltipContent>
              </Tooltip>
            );
          })}
        </nav>

        {mode === "admin" ? (
          <div className="mb-3 grid size-9 place-items-center rounded-xl border border-primary/20 bg-primary-light text-primary">
            <BookOpenText className="size-4" aria-hidden="true" />
            <span className="sr-only">Admin console</span>
          </div>
        ) : null}

        {utilityItems.length ? (
          <>
            <div className="mb-3 flex w-full justify-center">
              <span className="h-px w-7 bg-border" />
            </div>

            <nav className="flex flex-col items-center gap-2" aria-label="Account">
              {utilityItems.map((item) => {
                const Icon = iconMap[item.icon];
                const active = isNavigationItemActive(pathname, item);

                return (
                  <Tooltip key={item.href}>
                    <TooltipTrigger
                      render={
                        <Link
                          href={item.href}
                          onPointerEnter={() => prefetchRoute(item.href)}
                          onFocus={() => prefetchRoute(item.href)}
                          aria-label={item.label}
                          aria-current={active ? "page" : undefined}
                          className={cn(
                            "relative grid size-10 place-items-center rounded-xl text-foreground-faint outline-none transition-colors hover:bg-primary-light hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
                            active && "bg-primary-light text-primary",
                          )}
                        />
                      }
                    >
                      <Icon className="size-4.5" aria-hidden="true" />
                    </TooltipTrigger>
                    <TooltipContent side="right">{item.label}</TooltipContent>
                  </Tooltip>
                );
              })}
            </nav>
          </>
        ) : null}
      </div>
    </aside>
  );
}
