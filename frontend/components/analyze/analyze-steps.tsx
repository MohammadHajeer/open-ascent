export function AnalyzeSteps({ activeIndex }: { activeIndex: 0 | 1 | 2 }) {
  return (
    <nav
      className="flex items-center gap-2 border-b border-border py-5 sm:gap-4"
      aria-label="Analysis steps"
    >
      {["Exercise", "Video", "Analysis"].map((label, index) => (
        <div className="contents" key={label}>
          {index > 0 && <span className="h-px min-w-4 flex-1 bg-border" aria-hidden="true" />}
          <span
            className={`flex items-center gap-2 font-mono text-[0.6rem] font-semibold tracking-[0.08em] uppercase ${index <= activeIndex ? "text-primary" : "text-foreground-faint"}`}
            aria-current={index === activeIndex ? "step" : undefined}
          >
            <span
              className={`grid size-6 place-items-center rounded-full border ${index <= activeIndex ? "border-primary bg-primary text-primary-foreground" : "border-border"}`}
            >
              0{index + 1}
            </span>
            <span className="hidden sm:inline">{label}</span>
          </span>
        </div>
      ))}
    </nav>
  );
}
