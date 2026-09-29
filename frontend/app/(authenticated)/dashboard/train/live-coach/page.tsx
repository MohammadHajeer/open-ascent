import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { DashboardPageHeader } from "@/components/dashboard/dashboard-page-header";
import { buttonVariants } from "@/components/ui/button";
import { LiveCoachWorkspace } from "@/features/live-coach/live-coach-workspace";
import { cn } from "@/lib/utils";

export default function LiveCoachPage() {
  return (
    <div className="space-y-8">
      <DashboardPageHeader
        eyebrow="Train / Live Coach"
        title="One rep at a time."
        description="Real-time rep counting and form cues for pull-ups, push-ups, muscle-ups, and dips. Pose tracking runs in this browser, and only full-range reps count."
        action={
          <Link
            href="/dashboard/train"
            className={cn(buttonVariants({ variant: "outline" }), "gap-2")}
          >
            <ArrowLeft className="size-4" />
            Back to Train
          </Link>
        }
      />
      <div data-tour="live-coach"><LiveCoachWorkspace /></div>
    </div>
  );
}
