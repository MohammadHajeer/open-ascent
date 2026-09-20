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
      <section data-auth-panel className="relative overflow-hidden rounded-[4px_4px_32px_4px] border border-border/40 bg-card/80 dark:bg-card/75">
        <span aria-hidden="true" className="absolute top-0 left-0 h-px w-24 bg-primary/45" />
        <div className="px-5 pt-7 pb-7 sm:px-9 sm:pt-8 sm:pb-8 lg:px-10">
          <span className="inline-flex items-center gap-2 font-mono text-[0.57rem] font-semibold tracking-[0.17em] text-primary uppercase">
            <Icon className="size-3.5" aria-hidden="true" />
            {eyebrow}
          </span>

          <h1 className="mt-3.5 text-[clamp(1.95rem,4vw,2.45rem)] leading-[1.02] font-medium tracking-[-0.05em] text-foreground">
            {title}
          </h1>

          <p className="mt-2 max-w-sm text-sm leading-6 text-foreground-soft">
            {description}
          </p>

          {children}
        </div>

        {footer ? (
          <div className="border-t border-border/40 bg-background/15 px-5 py-4 text-left text-sm text-foreground-soft sm:px-9 lg:px-10">
            {footer}
          </div>
        ) : null}
      </section>
    </div>
  );
}
