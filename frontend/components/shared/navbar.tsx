"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowUpRight } from "lucide-react";

import { BrandLogo } from "@/components/brand/brand-logo";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { MobileNav } from "./mobile-nav";
import { ThemeToggle } from "./theme-toggle";

const navigation = [
  { label: "Home", href: "/" },
  { label: "Movements", href: "/movements" },
  { label: "Analyze", href: "/analyze" },
] as const;

export function Navbar() {
  const pathname = usePathname();
  const signInHref = "/login";

  const navigationItems = navigation.map((item) => ({
    ...item,
    active:
      item.href === "/"
        ? pathname === "/"
        : pathname === item.href || pathname.startsWith(`${item.href}/`),
  }));

  return (
    <header className="sticky top-0 z-50 border-b border-border/70 bg-background/85 backdrop-blur-xl">
      <nav
        aria-label="Primary navigation"
        className="mx-auto grid min-h-18 w-full max-w-360 grid-cols-[1fr_auto] items-center gap-4 px-4 sm:min-h-20 sm:px-6 lg:grid-cols-[1fr_auto_1fr] lg:gap-10 xl:px-8"
      >
        <Link
          href="/"
          aria-label="Open Ascent home"
          className="group flex w-max items-center gap-3"
        >
          <BrandLogo
            alt=""
            sizes="48px"
            className="size-12 max-w-none rounded-full sm:size-13"
          />

          <span className="grid leading-none">
            <strong className="text-[0.86rem] font-semibold tracking-tight text-foreground">
              Open Ascent
            </strong>

            <span className="mt-1.5 hidden font-mono text-[0.55rem] tracking-[0.12em] text-foreground-faint uppercase sm:block">
              Movement intelligence
            </span>
          </span>
        </Link>

        <div className="hidden items-center gap-1 rounded-full border border-border/70 bg-background-alt/60 p-1 lg:flex">
          {navigationItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              aria-current={item.active ? "page" : undefined}
              className={cn(
                "rounded-full px-4 py-2 text-[0.8rem] font-medium transition-colors",
                item.active
                  ? "bg-primary-light text-primary"
                  : "text-foreground-soft hover:bg-background hover:text-foreground",
              )}
            >
              {item.label}
            </Link>
          ))}
        </div>

        <div className="hidden items-center justify-end gap-3 lg:flex">
          <ThemeToggle />

          <Link
            href={signInHref}
            className="rounded-full px-3 py-2 text-[0.8rem] font-medium text-foreground-soft transition-colors hover:text-foreground"
          >
            Sign in
          </Link>

          <Link
            href="/analyze"
            className={cn(
              buttonVariants({
                size: "sm",
                variant: "brand",
              }),
              "gap-2 rounded-full px-4",
            )}
          >
            Analyze video
            <ArrowUpRight className="size-3.5" aria-hidden="true" />
          </Link>
        </div>

        <div className="flex items-center justify-end gap-2 lg:hidden">
          <div className="hidden sm:block">
            <ThemeToggle />
          </div>

          <MobileNav navigation={navigationItems} signInHref={signInHref} />
        </div>
      </nav>
    </header>
  );
}
