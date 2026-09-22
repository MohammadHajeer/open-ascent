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
        description="A local, deterministic pull-up coach. MediaPipe reads pose landmarks in your browser; Open Ascent counts only a complete bottom-to-top-to-bottom cycle."
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
      <LiveCoachWorkspace />
    </div>
  );
}

