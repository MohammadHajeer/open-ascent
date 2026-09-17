"use client";

import { useSyncExternalStore } from "react";
import { Check, Laptop, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const themeOptions = [
  { label: "Light", value: "light", icon: Sun },
  { label: "Dark", value: "dark", icon: Moon },
  { label: "System", value: "system", icon: Laptop },
] as const;

const subscribe = () => () => {};

export function ThemeToggle() {
  const mounted = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );

  const { theme, setTheme } = useTheme();

  if (!mounted) {
    return (
      <Button
        variant="ghost"
        size="icon"
        className="relative size-9 rounded-full border border-border text-foreground-soft hover:border-foreground-faint hover:bg-primary-light hover:text-foreground"
        aria-label="Choose color theme"
        disabled
      >
        <Sun className="size-3.75" aria-hidden="true" />
      </Button>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            className="relative size-9 rounded-full border border-border text-foreground-soft hover:border-foreground-faint hover:bg-primary-light hover:text-foreground"
            aria-label="Choose color theme"
          />
        }
      >
        <Sun
          className="size-3.75 rotate-0 scale-100 transition-transform dark:-rotate-90 dark:scale-0"
          aria-hidden="true"
        />

        <Moon
          className="absolute size-3.75 rotate-90 scale-0 transition-transform dark:rotate-0 dark:scale-100"
          aria-hidden="true"
        />

        <span className="sr-only">Choose color theme</span>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" aria-label="Color theme">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Appearance</DropdownMenuLabel>

          {themeOptions.map((option) => {
            const Icon = option.icon;

            return (
              <DropdownMenuItem
                key={option.value}
                onClick={() => setTheme(option.value)}
                className="gap-3"
              >
                <Icon aria-hidden="true" />

                <span>{option.label}</span>

                {theme === option.value && (
                  <Check className="ml-auto text-primary" aria-hidden="true" />
                )}
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
