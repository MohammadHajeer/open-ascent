"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowUpRight } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { getActiveWorkoutPresentation } from "./active-presentation";
import { useSessionNow } from "./components/session-timer";
import { useActiveWorkoutSession } from "./hooks";

export function ActiveWorkoutIndicator({
  surface = "dashboard",
}: {
  surface?: "dashboard" | "analyze";
}) {
  const pathname = usePathname();
  const onTrain = pathname === "/dashboard/train";
  const { data: active } = useActiveWorkoutSession(!onTrain);
  const nowMs = useSessionNow(onTrain ? null : active?.started_at ?? null);
  const presentation = getActiveWorkoutPresentation(active, nowMs, pathname);
  if (!presentation) return null;

  return (
    <section
      aria-label="Active workout"
      className={cn(
        "sticky z-20 border-b border-primary/20 bg-card/95 backdrop-blur-md",
        surface === "dashboard" ? "top-18" : "top-18 sm:top-20",
      )}
    >
      <div className={cn(
        "mx-auto grid min-h-14 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 px-4 py-2 sm:gap-4 sm:px-6 lg:px-8 xl:px-10",
        surface === "dashboard" ? "max-w-[1600px]" : "max-w-360",
      )}>
        <div className="flex min-w-0 flex-col items-start gap-1 sm:flex-row sm:items-center sm:gap-3">
          <Badge variant="outline" className="border-primary/25 bg-primary-light/60 font-mono text-[0.6rem] font-semibold tracking-[0.08em] text-primary uppercase">
            <span className="size-1.5 rounded-full bg-primary" aria-hidden="true" />
            {presentation.title}
          </Badge>
          <span aria-live="off" className="truncate font-mono text-xs tabular-nums text-foreground-soft">
            {presentation.detail}
          </span>
        </div>
        <Link
          href={presentation.href}
          aria-label={presentation.actionLabel}
          className={cn(buttonVariants({ variant: "outline", size: "sm" }), "min-h-11 gap-1.5 border-primary/25 bg-background/70 px-3 text-primary")}
        >
          {presentation.action}
          <ArrowUpRight className="size-3.5" aria-hidden="true" />
        </Link>
      </div>
    </section>
  );
}
