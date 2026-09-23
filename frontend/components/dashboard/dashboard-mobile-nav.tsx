"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRouter } from "next/navigation";
import {
  Activity,
  Bot,
  ChartNoAxesCombined,
  ClipboardList,
  CreditCard,
  Dumbbell,
  FileText,
  Library,
  MoreHorizontal,
  ScanLine,
  Settings,
  TrendingUp,
  UserRound,
  Users,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";

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

export function DashboardMobileNav({ mode }: { mode: DashboardMode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [moreOpen, setMoreOpen] = useState(false);
  const navigation = getNavigation(mode);
  const primary = mode === "admin"
    ? navigation.filter(item => ["/admin", "/admin/users", "/admin/analyses", "/admin/documentation"].includes(item.href))
    : navigation.filter(item => ["/dashboard", "/dashboard/train", "/dashboard/progress", "/dashboard/coach"].includes(item.href));
  const more = navigation.filter(item => !primary.includes(item));
  const athleteMore = [
    ...more,
    { label: "Profile", href: "/dashboard/profile", icon: "profile" as const },
    { label: "Live Coach", href: "/dashboard/train/live-coach", icon: "coach" as const },
    { label: "Analyze", href: "/analyze", icon: "analyze" as const },
    { label: "Movements", href: "/movements", icon: "movements" as const },
  ];
  const moreActive = (mode === "admin" ? more : athleteMore).some(item =>
    isNavigationItemActive(pathname, item) && !primary.some(primaryItem => isNavigationItemActive(pathname, primaryItem)),
  );

  return (
    <nav
      className={cn("dashboard-mobile-nav fixed inset-x-3 z-40 rounded-[1.4rem] border border-border/80 bg-card/95 p-1.5 shadow-[0_18px_50px_rgba(28,28,26,0.12)] backdrop-blur-xl lg:hidden dark:shadow-none", mode === "admin" ? "bottom-3" : "bottom-[calc(0.75rem+env(safe-area-inset-bottom))]")}
      aria-label={mode === "admin" ? "Admin navigation" : "Dashboard navigation"}
    >
      <div className={mode === "admin" ? "flex overflow-x-auto overscroll-x-contain" : "flex min-w-0"}>
        {primary.map((item) => {
          const Icon = iconMap[item.icon];
          const active = isNavigationItemActive(pathname, item);

          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                mode === "admin"
                  ? "relative flex min-w-18 flex-1 flex-col items-center justify-center gap-1 rounded-[1rem] px-1 py-2 text-[0.6rem] font-medium text-foreground-faint outline-none transition-colors hover:bg-primary-light hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                  : "relative flex min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-[1rem] px-0.5 py-2 text-[0.65rem] font-medium text-foreground-faint outline-none transition-colors hover:bg-primary-light hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
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
        {mode === "admin" ? <DropdownMenu><DropdownMenuTrigger render={<Button type="button" variant="ghost" aria-label="More admin sections" className={cn("relative flex h-auto min-w-18 flex-1 flex-col gap-1 rounded-[1rem] px-1 py-2 text-[0.6rem]", moreActive && "bg-primary-light text-primary")} />}><MoreHorizontal className="size-[1.05rem]" aria-hidden="true" /><span>More</span></DropdownMenuTrigger><DropdownMenuContent align="end" side="top" className="min-w-44">{more.map(item => <DropdownMenuItem key={item.href} onClick={() => router.push(item.href)}>{item.label}</DropdownMenuItem>)}</DropdownMenuContent></DropdownMenu> :
          <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
            <SheetTrigger render={<Button type="button" variant="ghost" aria-label="More destinations" aria-current={moreActive ? "page" : undefined} className={cn("relative flex h-auto min-w-0 flex-1 flex-col gap-1 rounded-[1rem] px-0.5 py-2 text-[0.65rem] text-foreground-faint", moreActive && "bg-primary-light text-primary")} />}>
              <MoreHorizontal className="size-[1.05rem]" aria-hidden="true" /><span>More</span>
            </SheetTrigger>
            <SheetContent side="bottom" className="max-h-[min(80dvh,38rem)] overflow-y-auto rounded-t-3xl pb-[calc(1.5rem+env(safe-area-inset-bottom))]">
              <SheetHeader><SheetTitle>Explore Open Ascent</SheetTitle></SheetHeader>
              <div className="grid gap-1 px-4 pb-2 sm:grid-cols-2">
                {athleteMore.map(item => {
                  const Icon = iconMap[item.icon];
                  const active = isNavigationItemActive(pathname, item);
                  return <Link key={item.href} href={item.href} onClick={() => setMoreOpen(false)} aria-current={active ? "page" : undefined} className={cn("flex min-h-12 items-center gap-3 rounded-xl px-3 text-sm font-medium text-foreground-soft outline-none hover:bg-primary-light focus-visible:ring-2 focus-visible:ring-ring", active && "bg-primary-light text-primary")}><Icon className="size-5 shrink-0" aria-hidden="true" />{item.label}</Link>;
                })}
              </div>
            </SheetContent>
          </Sheet>}
      </div>
    </nav>
  );
}
