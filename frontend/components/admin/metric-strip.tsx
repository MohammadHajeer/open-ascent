import { cn } from "@/lib/utils";

export type MetricItem = {
  label: string;
  value: number | string | undefined;
  detail?: string;
};

const columnClasses = {
  2: "sm:grid-cols-2",
  4: "sm:grid-cols-2 xl:grid-cols-4",
  5: "sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5",
} as const;

/**
 * Admin headline statistics. One shared treatment so the operations overview
 * and the management directories read as the same product.
 */
export function MetricStrip({
  items,
  footnote,
  columns = 4,
  label,
}: {
  items: MetricItem[];
  footnote?: string;
  columns?: keyof typeof columnClasses;
  label?: string;
}) {
  return (
    <section aria-label={label ?? "Statistics"}>
      <dl className={cn("grid gap-3", columnClasses[columns])}>
        {items.map((item) => (
          <div
            key={item.label}
            className="flex min-h-24 flex-col rounded-2xl border border-border/80 bg-card/65 px-5 py-4"
          >
            <dt className="text-xs font-medium text-foreground-soft">{item.label}</dt>
            <dd className="mt-3">
              <span className="block text-3xl leading-none font-medium tracking-[-0.045em] tabular-nums">
                {typeof item.value === "number" ? item.value.toLocaleString() : (item.value ?? "—")}
              </span>
              {item.detail ? (
                <span className="mt-2 block text-xs leading-5 text-foreground-faint">{item.detail}</span>
              ) : null}
            </dd>
          </div>
        ))}
      </dl>
      {footnote ? <p className="mt-3 text-xs text-foreground-faint">{footnote}</p> : null}
    </section>
  );
}
