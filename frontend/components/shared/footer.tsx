import Link from "next/link";

import { BrandLogo } from "@/components/brand/brand-logo";

import { ThemeToggle } from "./theme-toggle";

const footerLinks = [
  { label: "Home", href: "/" },
  { label: "Movements", href: "/movements" },
  { label: "Analyze", href: "/analyze" },
];

export function Footer() {
  return (
    <footer className="bg-background mt-auto">
      <div className="mx-auto grid w-full max-w-360 gap-12 px-4 py-16 sm:px-5 sm:py-20 lg:grid-cols-[1fr_auto] lg:items-start">
        <div>
          <Link
            href="/"
            aria-label="Open Ascent home"
            className="group flex w-max items-center gap-3"
          >
            <BrandLogo
              alt=""
              sizes="48px"
              className="size-12 max-w-none rounded-full sm:size-13"
            />

            <span className="grid leading-none">
              <strong className="text-[0.86rem] font-semibold tracking-tight text-foreground">
                Open Ascent
              </strong>

              <span className="mt-1.5 hidden font-mono text-[0.55rem] tracking-[0.12em] text-foreground-faint uppercase sm:block">
                Movement intelligence
              </span>
            </span>
          </Link>
          <p className="mt-6 max-w-sm text-sm leading-6 text-foreground-soft">
            Computer-vision movement analysis designed specifically for
            calisthenics.
          </p>
        </div>

        <div className="grid gap-10 sm:grid-cols-[auto_auto] sm:gap-16">
          <nav className="grid gap-3" aria-label="Footer navigation">
            <span className="mb-2 font-mono text-[0.58rem] tracking-widest text-foreground-faint uppercase">
              Navigate
            </span>
            {footerLinks.map((link) => (
              <Link
                className="text-sm text-foreground-soft transition-colors hover:text-foreground"
                href={link.href}
                key={link.href}
              >
                {link.label}
              </Link>
            ))}
          </nav>
          <div>
            <span className="mb-3 block font-mono text-[0.58rem] tracking-widest text-foreground-faint uppercase">
              Appearance
            </span>
            <ThemeToggle />
          </div>
        </div>
      </div>
      <div className="mx-auto flex w-full max-w-360 flex-wrap items-center justify-between gap-4 border-t border-border px-4 py-5 font-mono text-[0.55rem] tracking-[0.08em] text-foreground-faint uppercase sm:px-5">
        <span>Open Ascent</span>
        <span>Movement → Vision → Understanding → Coaching</span>
      </div>
    </footer>
  );
}
