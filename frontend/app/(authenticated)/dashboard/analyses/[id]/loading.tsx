import { DashboardPageHeader } from "@/components/dashboard/dashboard-page-header";

export default function AnalysisDetailLoading() {
  return (
    <div className="space-y-8">
      <DashboardPageHeader eyebrow="Movement record / Detail" title="Analysis detail." />
      <div
        role="status"
        aria-label="Loading analysis detail"
        className="min-h-80 animate-pulse rounded-[1.6rem] border border-border/80 bg-card/65 p-6 sm:p-8"
      >
        <div className="h-2 w-24 rounded-full bg-primary-light" />
        <div className="mt-5 h-6 w-48 rounded-md bg-muted" />
        <div className="mt-12 h-3 w-full max-w-lg rounded-full bg-muted" />
        <div className="mt-3 h-3 w-2/3 max-w-md rounded-full bg-muted" />
      </div>
    </div>
  );
}
