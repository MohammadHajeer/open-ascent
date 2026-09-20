"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { isActiveNavItem } from "@/components/shared/navbar-navigation";
import { cn } from "@/lib/utils";

export function NavbarLinks({ navigation }: { navigation: readonly { label: string; href: string }[] }) {
  const pathname = usePathname();

  return (
    <div className="hidden items-center gap-1 rounded-full border border-border/70 bg-background-alt/60 p-1 lg:flex">
      {navigation.map((item) => {
        const active = isActiveNavItem(pathname, item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "rounded-full px-4 py-2 text-[0.8rem] font-medium transition-colors",
              active
                ? "bg-primary-light text-primary"
                : "text-foreground-soft hover:bg-background hover:text-foreground",
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </div>
  );
}
