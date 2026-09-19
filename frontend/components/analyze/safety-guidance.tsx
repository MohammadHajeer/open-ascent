import type { Safety } from "@/lib/analysis";

const sections: { key: keyof Safety; title: string }[] = [
  { key: "setup", title: "Set up" },
  { key: "prerequisites", title: "Before you begin" },
  { key: "stressed_areas", title: "Areas under load" },
  { key: "cautions", title: "Use caution" },
  { key: "stop_conditions", title: "Stop the set if" },
];

export function SafetyGuidance({
  safety,
  movementName,
}: {
  safety: Safety;
  movementName: string;
}) {
  return (
    <section
      className="mt-8 rounded-[3px_3px_34px_3px] border border-border bg-card p-6 sm:p-9"
      aria-labelledby="safety-guidance-title"
    >
      <span className="font-mono text-[0.58rem] font-semibold tracking-widest text-primary uppercase">
        Safety / Readiness
      </span>
      <h3
        id="safety-guidance-title"
        className="mt-3 text-3xl font-medium tracking-tighter text-foreground"
      >
        {movementName} guidance.
      </h3>
      {safety.notice && (
        <p className="mt-4 max-w-3xl text-sm leading-6 text-foreground-soft">
          {safety.notice}
        </p>
      )}
      <div className="mt-7 grid gap-6 border-t border-border pt-7 sm:grid-cols-2 lg:grid-cols-5">
        {sections.map(({ key, title }) => {
          const items = safety[key];
          return Array.isArray(items) && items.length ? (
            <div key={key}>
              <h4 className="text-sm font-semibold text-foreground">{title}</h4>
              <ul className="mt-3 grid gap-2 text-xs leading-5 text-foreground-soft">
                {items.map((item) => (
                  <li key={item}>• {item}</li>
                ))}
              </ul>
            </div>
          ) : null;
        })}
      </div>
      {safety.easier_option && (
        <p className="mt-7 rounded-2xl bg-primary-light p-4 text-sm leading-6 text-foreground-mid">
          <strong>Easier option: </strong>
          {safety.easier_option}
        </p>
      )}
      <p className="mt-6 text-xs leading-5 text-foreground-faint">
        This analysis does not assess injury or medical readiness. If symptoms
        or concerns arise, stop and consult a qualified professional.
      </p>
    </section>
  );
}
