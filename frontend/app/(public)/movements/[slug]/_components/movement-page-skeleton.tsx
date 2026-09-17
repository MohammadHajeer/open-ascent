import { Skeleton } from "@/components/ui/skeleton";

export function MovementPageSkeleton() {
  return (
    <main className="min-h-dvh overflow-x-hidden bg-background" aria-hidden="true">
      <div className="border-b border-border">
        <div className="mx-auto grid w-full max-w-360 gap-10 px-4 py-12 sm:px-5 sm:py-16 lg:grid-cols-[minmax(0,0.9fr)_minmax(420px,1.1fr)] lg:items-center lg:gap-16 lg:py-20">
          <div>
            <Skeleton className="h-4 w-32" />
            <Skeleton className="mt-8 h-6 w-36 rounded-full" />
            <Skeleton className="mt-6 h-20 w-3/4 sm:h-28" />
            <Skeleton className="mt-7 h-3 w-44" />
            <div className="mt-6 space-y-3">
              <Skeleton className="h-4 w-full max-w-xl" />
              <Skeleton className="h-4 w-5/6 max-w-lg" />
            </div>
          </div>
          <Skeleton className="min-h-107.5 rounded-[3px_34px_3px_3px] sm:min-h-140" />
        </div>
      </div>

      <div className="mx-auto w-full max-w-360 px-4 py-20 sm:px-5 sm:py-24">
        <Skeleton className="h-3 w-32" />
        <Skeleton className="mt-5 h-12 w-72" />
        <div className="mt-10 grid gap-5 sm:grid-cols-2">
          <Skeleton className="h-48" />
          <Skeleton className="h-48" />
        </div>
      </div>
    </main>
  );
}
