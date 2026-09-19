import { Skeleton } from "@/components/ui/skeleton";
import { AnalyzeSteps } from "./analyze-steps";

export function AnalyzeSectionSkeleton({ selected }: { selected: boolean }) {
  return (
    <div aria-label="Loading analysis options" role="status">
      <AnalyzeSteps activeIndex={selected ? 1 : 0} />
      <div className="pt-12 sm:pt-16" aria-hidden="true">
        {selected ? (
          <>
            <Skeleton className="mb-6 h-8 w-32" />
            <Skeleton className="h-3 w-32" />
            <Skeleton className="mt-4 h-10 w-full max-w-md" />
            <div className="mt-8 overflow-hidden rounded-[3px_3px_34px_3px] border border-border bg-card lg:grid lg:grid-cols-[minmax(0,1fr)_360px]">
              <Skeleton className="min-h-90 rounded-none lg:min-h-140" />
              <div className="grid content-start gap-5 p-6">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-7 w-3/4" />
                <Skeleton className="mt-6 h-4 w-full" />
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="mt-8 h-9 w-full" />
              </div>
            </div>
            <Skeleton className="mt-8 h-64 rounded-[3px_3px_34px_3px]" />
          </>
        ) : (
          <>
            <Skeleton className="h-3 w-32" />
            <Skeleton className="mt-4 h-10 w-full max-w-md" />
            <Skeleton className="mt-4 h-4 w-full max-w-xl" />
            <div className="mt-8 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
              {Array.from({ length: 4 }, (_, index) => (
                <div key={index} className="overflow-hidden rounded-[3px_3px_24px_3px] border border-border bg-card">
                  <Skeleton className="aspect-4/3 rounded-none" />
                  <div className="space-y-3 px-5 py-4">
                    <Skeleton className="h-4 w-2/3" />
                    <Skeleton className="h-3 w-1/2" />
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
