export function DashboardEmptyState({
  icon,
  title,
  description,
  action,
  visual,
}: {
  icon?: React.ReactNode;
  title: string;
  description: string;
  action?: React.ReactNode;
  visual?: React.ReactNode;
}) {
  return (
    <div className="relative grid min-h-72 place-items-center overflow-hidden px-6 py-12 text-center sm:min-h-80">
      <div
        className="pointer-events-none absolute inset-0 cv-grid cv-grid-radial opacity-[0.1]"
        aria-hidden="true"
      />
      <div className="relative max-w-md">
        {visual ? (
          <div className="mx-auto flex h-32 items-center justify-center">
            {visual}
          </div>
        ) : (
          <span className="mx-auto grid size-12 place-items-center rounded-[1rem] border border-primary/20 bg-primary-light text-primary">
            {icon}
          </span>
        )}
        <h3 className="mt-5 text-xl font-medium tracking-[-0.035em] text-foreground">
          {title}
        </h3>
        <p className="mt-2 text-sm leading-6 text-foreground-soft">
          {description}
        </p>
        {action ? <div className="mt-6">{action}</div> : null}
      </div>
    </div>
  );
}
