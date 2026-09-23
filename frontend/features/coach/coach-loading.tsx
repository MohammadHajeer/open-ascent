import { Skeleton } from "@/components/ui/skeleton";

export function CoachHistoryLoading() {
  return (
    <div className="min-h-0 flex-1 px-4 py-6 sm:px-7 lg:px-10" role="status" aria-label="Loading conversation">
      <div className="mx-auto w-full max-w-[780px] space-y-9" aria-hidden="true">
        <div className="grid gap-3 sm:grid-cols-[112px_minmax(0,1fr)] sm:gap-5">
          <Skeleton className="h-3 w-10" />
          <div className="space-y-2"><Skeleton className="h-4 w-3/4" /><Skeleton className="h-4 w-1/2" /></div>
        </div>
        <div className="grid gap-3 sm:grid-cols-[112px_minmax(0,1fr)] sm:gap-5">
          <Skeleton className="h-3 w-24" />
          <div className="space-y-2"><Skeleton className="h-4 w-full" /><Skeleton className="h-4 w-5/6" /><Skeleton className="h-4 w-2/3" /></div>
        </div>
      </div>
    </div>
  );
}
