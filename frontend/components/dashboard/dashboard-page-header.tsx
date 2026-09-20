export function DashboardPageHeader({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-5 border-b border-border/75 pb-7 sm:flex-row sm:items-end sm:justify-between">
      <div className="max-w-3xl">
        {eyebrow ? (
          <span className="font-mono text-[0.58rem] font-semibold tracking-[0.14em] text-primary uppercase">
            {eyebrow}
          </span>
        ) : null}

        <h1 className="mt-2 text-[clamp(2.2rem,5vw,4.5rem)] leading-[0.92] font-medium tracking-[-0.06em] text-foreground">
          {title}
        </h1>

        {description ? (
          <p className="mt-3 max-w-2xl text-sm leading-6 text-foreground-soft sm:text-[0.95rem]">
            {description}
          </p>
        ) : null}
      </div>

      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}
