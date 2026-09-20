"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  ChartNoAxesCombined,
  Dumbbell,
  FileText,
  ScanLine,
  Settings,
  UserRound,
  Users,
} from "lucide-react";

import { cn } from "@/lib/utils";

import {
  getNavigation,
  isNavigationItemActive,
  type DashboardMode,
  type DashboardNavIcon,
} from "./dashboard-navigation";

const iconMap = {
  overview: ChartNoAxesCombined,
  analyses: Activity,
  analyze: ScanLine,
  profile: UserRound,
  settings: Settings,
  movements: Dumbbell,
  documentation: FileText,
  users: Users,
} satisfies Record<DashboardNavIcon, React.ComponentType<{ className?: string }>>;

export function DashboardMobileNav({ mode }: { mode: DashboardMode }) {
  const pathname = usePathname();
  const navigation = getNavigation(mode);

  return (
    <nav
      className="fixed inset-x-3 bottom-3 z-40 rounded-[1.4rem] border border-border/80 bg-card/95 p-1.5 shadow-[0_18px_50px_rgba(28,28,26,0.12)] backdrop-blur-xl lg:hidden dark:shadow-none"
      aria-label={mode === "admin" ? "Admin navigation" : "Dashboard navigation"}
    >
      <div
        className="grid"
        style={{
          gridTemplateColumns: `repeat(${navigation.length}, minmax(0, 1fr))`,
        }}
      >
        {navigation.map((item) => {
          const Icon = iconMap[item.icon];
          const active = isNavigationItemActive(pathname, item);

          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "relative flex min-w-0 flex-col items-center justify-center gap-1 rounded-[1rem] px-1 py-2 text-[0.6rem] font-medium text-foreground-faint outline-none transition-colors hover:bg-primary-light hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
                active && "bg-primary-light text-primary",
                item.emphasis &&
                  !active &&
                  "text-primary",
              )}
            >
              <Icon className="size-[1.05rem]" aria-hidden="true" />
              <span className="max-w-full truncate">{item.label}</span>
              {active ? (
                <span
                  className="absolute top-0 h-0.5 w-5 rounded-full bg-primary"
                  aria-hidden="true"
                />
              ) : null}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
