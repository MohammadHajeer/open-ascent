import Link from "next/link";
import {
  ArrowUpRight,
  BookOpenText,
  Dumbbell,
  FileText,
  Users,
} from "lucide-react";

import { DashboardPageHeader } from "@/components/dashboard/dashboard-page-header";

const adminAreas = [
  {
    title: "Documentation",
    description: "Draft, edit, publish, and archive movement guides.",
    href: "/admin/documentation",
    icon: FileText,
  },
  {
    title: "Movements",
    description: "Manage the movement catalog and analysis availability.",
    href: "/admin/movements",
    icon: Dumbbell,
  },
  {
    title: "Users",
    description: "User administration will connect after AUTH-02.",
    href: "/admin/users",
    icon: Users,
  },
];

export default function AdminPage() {
  return (
    <div className="space-y-8">
      <DashboardPageHeader
        eyebrow="Admin console"
        title="Control the movement library."
        description="A focused workspace for Open Ascent administration. Authorization will remain enforced by the backend and AUTH-02."
      />

      <section className="grid gap-4 md:grid-cols-3">
        {adminAreas.map(({ title, description, href, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className="group relative min-h-56 overflow-hidden rounded-[1.6rem] border border-border bg-card/75 p-6 outline-none transition-colors hover:border-primary/40 hover:bg-primary-light/30 focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className="grid size-10 place-items-center rounded-2xl border border-primary/20 bg-primary-light text-primary">
              <Icon className="size-4.5" aria-hidden="true" />
            </span>

            <div className="mt-12">
              <h2 className="text-xl font-medium tracking-[-0.035em]">
                {title}
              </h2>
              <p className="mt-2 max-w-xs text-sm leading-6 text-foreground-soft">
                {description}
              </p>
            </div>

            <ArrowUpRight
              className="absolute top-6 right-6 size-4 text-foreground-faint transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-primary"
              aria-hidden="true"
            />
          </Link>
        ))}
      </section>

      <section className="rounded-[1.6rem] border border-border bg-background-alt/55 p-6 sm:p-8">
        <div className="flex items-start gap-4">
          <span className="grid size-10 shrink-0 place-items-center rounded-2xl border border-primary/20 bg-primary-light text-primary">
            <BookOpenText className="size-4.5" aria-hidden="true" />
          </span>

          <div>
            <span className="font-mono text-[0.56rem] font-semibold tracking-[0.13em] text-primary uppercase">
              Next connection
            </span>
            <h2 className="mt-2 text-xl font-medium tracking-[-0.035em]">
              SAF-06 can plug into this shell.
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-foreground-soft">
              Once AUTH-02 is complete, the documentation CMS can live inside
              this admin workspace without changing the shared dashboard
              structure.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
