import type { LucideIcon } from "lucide-react";

type AuthPanelProps = {
  icon: LucideIcon;
  eyebrow: string;
  title: string;
  description: string;
  footer?: React.ReactNode;
  children: React.ReactNode;
};

export function AuthPanel({
  icon: Icon,
  eyebrow,
  title,
  description,
  footer,
  children,
}: AuthPanelProps) {
  return (
    <div className="w-full">
      <section className="rounded-[4px_4px_34px_4px] border border-border bg-card p-6 backdrop-blur-sm sm:p-9 lg:p-10">
        <span className="inline-flex items-center gap-2 font-mono text-[0.58rem] font-semibold tracking-[0.17em] text-primary uppercase">
          <Icon className="size-3.5" aria-hidden="true" />
          {eyebrow}
        </span>

        <h1 className="mt-4 text-[clamp(2.05rem,4vw,2.65rem)] leading-[0.95] font-medium tracking-[-0.055em] text-foreground">
          {title}
        </h1>

        <p className="mt-3 max-w-sm text-sm leading-6 text-foreground-soft">
          {description}
        </p>

        {children}
      </section>

      {footer ? (
        <p className="mt-6 text-center text-sm text-foreground-soft">{footer}</p>
      ) : null}
    </div>
  );
}
