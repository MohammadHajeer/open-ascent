export function DashboardSection({
  eyebrow,
  title,
  description,
  aside,
  children,
}: {
  eyebrow: string;
  title: string;
  description?: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-[1.6rem] border border-border/80 bg-card/65">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border/75 px-5 py-5 sm:px-7">
        <div>
          <p className="font-mono text-[0.56rem] font-semibold tracking-[0.14em] text-primary uppercase">
            {eyebrow}
          </p>
          <h2 className="mt-2 text-xl font-medium tracking-[-0.035em] text-foreground">
            {title}
          </h2>
          {description ? (
            <p className="mt-1 max-w-2xl text-sm leading-6 text-foreground-soft">
              {description}
            </p>
          ) : null}
        </div>
        {aside}
      </div>
      {children}
    </section>
  );
}
