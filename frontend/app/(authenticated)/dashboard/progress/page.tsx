import { DashboardPageHeader } from "@/components/dashboard/dashboard-page-header";
import { ProgressView } from "@/features/progress/progress-view";

export default function ProgressPage() {
  return (
    <div className="space-y-8">
      <DashboardPageHeader
        eyebrow="Training evidence"
        title="Progress, without guesswork."
        description="See your weekly consistency and compare real logged performance for one movement at a time."
      />
      <ProgressView />
    </div>
  );
}
