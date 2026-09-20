"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowUpRight, ScanLine } from "lucide-react";

import { BrandLogo } from "@/components/brand/brand-logo";
import { ThemeToggle } from "@/components/shared/theme-toggle";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { DashboardAccountMenu } from "./dashboard-account-menu";
import {
  getCurrentNavigationLabel,
  type DashboardMode,
} from "./dashboard-navigation";

export function DashboardTopbar({ mode }: { mode: DashboardMode }) {
  const pathname = usePathname();
  const currentLabel = getCurrentNavigationLabel(pathname, mode);

  return (
    <header className="sticky top-0 z-30 border-b border-border/75 bg-background/88 backdrop-blur-xl">
      <div className="mx-auto flex h-18 w-full max-w-[1600px] items-center gap-3 px-4 sm:px-6 lg:px-8 xl:px-10">
        <Link
          href={mode === "admin" ? "/admin" : "/dashboard"}
          className="flex min-w-0 items-center gap-2.5 lg:hidden"
          aria-label={mode === "admin" ? "Admin overview" : "Dashboard"}
        >
          <BrandLogo
            alt=""
            variant="dashboard"
            className="size-9 rounded-full bg-logo-surface dark:bg-transparent"
            sizes="36px"
          />
          <span className="truncate text-sm font-semibold tracking-[-0.02em]">
            Open Ascent
          </span>
        </Link>

        <div className="hidden min-w-0 lg:block">
          <span className="block font-mono text-[0.55rem] font-semibold tracking-[0.13em] text-primary uppercase">
            {mode === "admin" ? "Admin console" : "Training console"}
          </span>
          <span className="mt-0.5 block truncate text-sm font-medium text-foreground">
            {currentLabel}
          </span>
        </div>

        <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
          {mode === "user" ? (
            <Link
              href="/analyze"
              className={cn(
                buttonVariants({ variant: "brand", size: "sm" }),
                "hidden gap-2 sm:inline-flex",
              )}
            >
              <ScanLine className="size-4" aria-hidden="true" />
              Analyze movement
            </Link>
          ) : (
            <Link
              href="/"
              className={cn(
                buttonVariants({ variant: "outline", size: "sm" }),
                "hidden gap-2 sm:inline-flex",
              )}
            >
              View site
              <ArrowUpRight className="size-3.5" aria-hidden="true" />
            </Link>
          )}

          <ThemeToggle />
          <DashboardAccountMenu />
        </div>
      </div>
    </header>
  );
}
