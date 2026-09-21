import { DashboardSection } from "@/components/dashboard/dashboard-section";
import { Skeleton } from "@/components/ui/skeleton";

const rows = ["w-3/5", "w-4/5", "w-2/5", "w-3/4", "w-1/2"];

export function MovementListSkeleton() {
  return (
    <DashboardSection
      eyebrow="Catalog"
      title={<Skeleton className="h-6 w-32" />}
      description={<Skeleton className="mt-2 h-4 w-72 max-w-full" />}
      aside={<Skeleton className="h-9 w-64 max-w-full" />}
    >
      <div className="overflow-hidden">
        <div className="grid grid-cols-[minmax(220px,1.4fr)_minmax(120px,0.7fr)_minmax(100px,0.6fr)_minmax(120px,0.7fr)_80px] gap-4 border-b border-border/70 bg-background-alt/35 px-5 py-3 sm:px-7">
          {rows.slice(0, 5).map((width, index) => <Skeleton key={index} className={`h-3 ${width}`} />)}
        </div>
        <div className="divide-y divide-border/60">
          {rows.map((width, index) => (
            <div key={index} className="grid grid-cols-[minmax(220px,1.4fr)_minmax(120px,0.7fr)_minmax(100px,0.6fr)_minmax(120px,0.7fr)_80px] items-center gap-4 px-5 py-4 sm:px-7">
              <div className="flex items-center gap-3"><Skeleton className="size-9 rounded-xl" /><div className="space-y-2"><Skeleton className={`h-4 ${width}`} /><Skeleton className="h-2.5 w-24" /></div></div>
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-5 w-16 rounded-full" />
              <Skeleton className="h-7 w-14 rounded-lg" />
            </div>
          ))}
        </div>
      </div>
    </DashboardSection>
  );
}

export function MovementDetailSkeleton() {
  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1.4fr)_minmax(280px,0.7fr)]">
      <div className="overflow-hidden rounded-[1.6rem] border border-border/80 bg-card/65">
        <div className="border-b border-border/75 px-5 py-5 sm:px-7"><Skeleton className="h-2.5 w-28" /><Skeleton className="mt-3 h-7 w-52" /><Skeleton className="mt-2 h-4 w-80 max-w-full" /></div>
        <div className="grid gap-px bg-border/60 sm:grid-cols-2">
          {rows.slice(0, 6).map((width, index) => <div key={index} className="space-y-3 bg-card/75 px-5 py-5 sm:px-7"><Skeleton className="h-2.5 w-20" /><Skeleton className={`h-4 ${width}`} /></div>)}
        </div>
        <div className="flex gap-3 border-t border-border/70 px-5 py-5 sm:px-7"><Skeleton className="h-9 w-40 rounded-lg" /><Skeleton className="h-9 w-28 rounded-lg" /></div>
      </div>
      <div className="space-y-5">
        <SkeletonCard titleWidth="w-28" lineWidths={["w-36", "w-32"]} />
        <SkeletonCard titleWidth="w-36" lineWidths={["w-56", "w-48", "w-40"]} />
      </div>
    </div>
  );
}

export function DocumentationListSkeleton() {
  return (
    <div className="space-y-5">
      <SkeletonCard titleWidth="w-56" lineWidths={["w-80", "w-full"]} action />
      <div className="overflow-hidden rounded-[1.6rem] border border-border/80 bg-card/65">
        <div className="flex items-start justify-between border-b border-border/75 px-5 py-5 sm:px-7"><div><Skeleton className="h-2.5 w-24" /><Skeleton className="mt-3 h-7 w-52" /><Skeleton className="mt-2 h-4 w-72 max-w-full" /></div><Skeleton className="size-5 rounded-md" /></div>
        <div className="grid gap-3 border-b border-border/70 bg-background-alt/25 px-5 py-4 sm:grid-cols-[minmax(180px,1fr)_180px_220px] sm:px-7"><Skeleton className="h-9 w-full" /><Skeleton className="h-9 w-full" /><Skeleton className="h-9 w-full" /></div>
        <div className="divide-y divide-border/60">
          {rows.map((width, index) => <div key={index} className="grid grid-cols-[minmax(220px,1.5fr)_80px_110px_120px_120px_60px] items-center gap-4 px-5 py-4 sm:px-7"><div className="space-y-2"><Skeleton className={`h-4 ${width}`} /><Skeleton className="h-2.5 w-24" /></div><Skeleton className="h-3 w-8" /><Skeleton className="h-5 w-20 rounded-full" /><Skeleton className="h-3 w-20" /><Skeleton className="h-3 w-20" /><Skeleton className="h-7 w-12 rounded-lg" /></div>)}
        </div>
      </div>
    </div>
  );
}

export function DocumentationDetailSkeleton() {
  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3"><Skeleton className="h-9 w-40 rounded-lg" /><Skeleton className="h-9 w-48 rounded-lg" /></div>
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.5fr)_minmax(280px,0.7fr)]">
        <div className="overflow-hidden rounded-[1.6rem] border border-border/80 bg-card/65">
          <div className="flex items-start justify-between gap-4 border-b border-border/75 px-5 py-5 sm:px-7"><div><Skeleton className="h-2.5 w-36" /><Skeleton className="mt-3 h-7 w-52" /><Skeleton className="mt-2 h-4 w-96 max-w-full" /></div><Skeleton className="h-5 w-20 rounded-full" /></div>
          <div className="space-y-8 px-5 py-6 sm:px-7">
            <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_220px]"><SkeletonField className="h-28" /><SkeletonField /></div>
            {["w-3/4", "w-2/3", "w-4/5", "w-3/5", "w-2/3"].map((width, index) => <div key={index} className="space-y-3"><Skeleton className="h-4 w-28" /><Skeleton className="h-3 w-64 max-w-full" /><div className="flex gap-2"><Skeleton className={`h-11 ${width} flex-1`} /><Skeleton className="size-8 rounded-lg" /></div><Skeleton className="h-11 w-4/5" /></div>)}
          </div>
        </div>
        <div className="space-y-5"><SkeletonCard titleWidth="w-36" lineWidths={["w-full", "w-5/6", "w-4/5"]} /><SkeletonCard titleWidth="w-44" lineWidths={["w-24", "w-32", "w-28", "w-36"]} /></div>
      </div>
    </div>
  );
}

function SkeletonField({ className = "h-11" }: { className?: string }) {
  return <div className="space-y-3"><Skeleton className="h-4 w-24" /><Skeleton className="h-3 w-48 max-w-full" /><Skeleton className={`${className} w-full`} /></div>;
}

function SkeletonCard({ titleWidth, lineWidths, action = false }: { titleWidth: string; lineWidths: string[]; action?: boolean }) {
  return <div className="overflow-hidden rounded-[1.6rem] border border-border/80 bg-card/65"><div className="flex items-start justify-between gap-4 border-b border-border/75 px-5 py-5 sm:px-7"><div><Skeleton className="h-2.5 w-24" /><Skeleton className={`mt-3 h-6 ${titleWidth}`} /></div>{action ? <Skeleton className="size-5 rounded-md" /> : null}</div><div className="space-y-4 px-5 py-6 sm:px-7">{lineWidths.map((width, index) => <Skeleton key={index} className={`h-4 ${width} max-w-full`} />)}</div></div>;
}
