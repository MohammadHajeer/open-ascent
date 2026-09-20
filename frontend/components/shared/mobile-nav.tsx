"use client";

import { useState, type MouseEvent } from "react";
import Link from "next/link";
import { ArrowUpRight, Menu } from "lucide-react";

import { Button, buttonVariants } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "./theme-toggle";

type NavItem = {
  label: string;
  href: string;
  active?: boolean;
};

export function MobileNav({
  navigation,
  signInHref,
}: {
  navigation: NavItem[];
  signInHref: string;
}) {
  const [open, setOpen] = useState(false);

  function navigateToSection(
    event: MouseEvent<HTMLAnchorElement>,
    href: string,
  ) {
    setOpen(false);

    if (!href.startsWith("#")) return;

    event.preventDefault();

    window.setTimeout(() => {
      const target = document.querySelector(href);

      target?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });

      window.history.replaceState(null, "", href);
    }, 180);
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            className="size-10 border border-border lg:hidden"
            aria-label="Open navigation"
          />
        }
      >
        <Menu className="size-4" aria-hidden="true" />
      </SheetTrigger>

      <SheetContent className="p-6 pt-8">
        <SheetHeader className="border-b border-border pb-6 pr-12">
          <SheetTitle className="text-left text-base">
            Open Ascent
          </SheetTitle>

          <SheetDescription className="text-left font-mono text-[0.62rem] tracking-widest uppercase">
            Movement intelligence
          </SheetDescription>
        </SheetHeader>

        <nav className="grid py-8" aria-label="Mobile navigation">
          {navigation.map((item, index) => (
            <Link
              key={item.href}
              href={item.href}
              onClick={(event) => navigateToSection(event, item.href)}
              aria-current={item.active ? "page" : undefined}
              className={cn(
                "group flex min-h-16 items-center justify-between border-b border-border text-lg font-medium tracking-[-0.03em] transition-colors hover:text-primary",
                item.active ? "text-primary" : "text-foreground",
              )}
            >
              <span className="flex items-center gap-4">
                <small className="font-mono text-[0.58rem] tracking-wider text-foreground-faint">
                  0{index + 1}
                </small>

                {item.label}
              </span>

              <ArrowUpRight
                className="size-4 text-foreground-faint transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-primary"
                aria-hidden="true"
              />
            </Link>
          ))}

          <Link
            className="flex min-h-16 items-center gap-4 border-b border-border text-lg font-medium tracking-[-0.03em] text-foreground"
            href={signInHref}
            onClick={(event) => navigateToSection(event, signInHref)}
          >
            <small className="font-mono text-[0.58rem] tracking-wider text-foreground-faint">
              04
            </small>
            Sign in
          </Link>
        </nav>

        <SheetFooter className="gap-5 border-t border-border pt-6">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[0.62rem] tracking-widest text-foreground-faint uppercase">
              Color theme
            </span>

            <ThemeToggle />
          </div>

          <Link
            href="/analyze"
            onClick={() => setOpen(false)}
            className={cn(
              buttonVariants({
                variant: "brand",
                size: "lg",
              }),
              "w-full",
            )}
          >
            Analyze a video
            <ArrowUpRight className="size-4" aria-hidden="true" />
          </Link>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
