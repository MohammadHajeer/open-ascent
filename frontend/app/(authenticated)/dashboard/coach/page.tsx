import { CoachWorkspace } from "@/features/coach/coach-workspace";

export default function CoachPage() {
  return (
    <div data-coach-page className="flex h-full min-h-0 flex-col gap-3 lg:gap-4">
      <header className="flex shrink-0 items-end justify-between gap-5">
        <div>
          <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-primary">Athlete guidance</p>
          <h1 className="mt-1 text-[clamp(2rem,4vw,3.1rem)] font-medium leading-none tracking-[-0.055em] text-foreground">AI Coach</h1>
        </div>
        <p className="hidden max-w-md pb-1 text-right text-xs leading-5 text-foreground-soft sm:block">A focused place for technique, skills, and your next training decision.</p>
      </header>
      <div data-tour="ai-coach" className="flex min-h-0 min-w-0 flex-1 flex-col"><CoachWorkspace /></div>
    </div>
  );
}
