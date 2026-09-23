import type { Safety } from "@/lib/analysis";
import { ThemedAsset } from "@/components/shared/themed-asset";
import { assets } from "@/lib/assets";

const sections = [
  { key: "setup", title: "Set up", asset: assets.safety.equipmentSetup },
  { key: "prerequisites", title: "Before you begin", asset: assets.safety.prerequisites },
  { key: "stressed_areas", title: "Areas under load", asset: assets.safety.stressedBodyAreas },
  { key: "cautions", title: "Use caution", asset: assets.safety.caution },
  { key: "stop_conditions", title: "Stop the set if", asset: assets.safety.stopCondition },
] as const;

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
        {sections.map(({ key, title, asset }) => {
          const items = safety[key];
          return Array.isArray(items) && items.length ? (
            <div key={key}>
              <h4 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <ThemedAsset asset={asset} alt="" width={20} />
                {title}
              </h4>
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
