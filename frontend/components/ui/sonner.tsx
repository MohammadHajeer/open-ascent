"use client"

import { useTheme } from "next-themes"
import { usePathname } from "next/navigation"
import { Toaster as Sonner, type ToasterProps } from "sonner"
import {
  CircleCheckIcon,
  InfoIcon,
  Loader2Icon,
  OctagonXIcon,
  TriangleAlertIcon,
} from "lucide-react"

/*
  Open Ascent toast treatment.

  Every `toast.*()` call in the app inherits this. Sonner's built-in styles are
  unlayered and would beat Tailwind utilities, so the toast runs `unstyled` and
  all visual decisions live in the class maps below. Semantics come from
  `data-type` on the toast (success / error / warning / info / loading).
*/
const iconChip =
  "grid size-6 shrink-0 place-items-center rounded-full [&>svg]:size-3.5"

const toastClassNames: NonNullable<ToasterProps["toastOptions"]>["classNames"] = {
  toast: [
    "group/toast flex w-full items-start gap-3 rounded-xl border border-border bg-popover px-3.5 py-3 font-sans text-popover-foreground",
    "shadow-[0_12px_32px_-14px_rgba(28,28,26,0.32)] dark:shadow-[0_12px_32px_-14px_rgba(0,0,0,0.7)]",
    "data-[type=error]:border-destructive/35 data-[type=warning]:border-warning/40",
  ].join(" "),
  icon: "relative flex size-6 shrink-0",
  content: "flex min-w-0 flex-1 flex-col gap-0.5 self-center",
  title: "text-sm leading-5 font-medium text-foreground",
  description: "text-xs leading-5 text-foreground-soft",
  actionButton:
    "ml-1 inline-flex h-7 shrink-0 items-center self-center rounded-lg bg-primary px-2.5 text-xs font-medium text-primary-foreground outline-none transition-colors hover:bg-primary/85 focus-visible:ring-3 focus-visible:ring-ring/50",
  cancelButton:
    "ml-1 inline-flex h-7 shrink-0 items-center self-center rounded-lg bg-muted px-2.5 text-xs font-medium text-foreground outline-none transition-colors hover:bg-muted/70 focus-visible:ring-3 focus-visible:ring-ring/50",
  closeButton:
    "absolute top-2 right-2 grid size-6 place-items-center rounded-md text-foreground-faint outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50",
}

function ToastIcon({
  tone,
  children,
}: {
  tone: "success" | "error" | "warning" | "info"
  children: React.ReactNode
}) {
  const tones = {
    success: "bg-primary-light text-primary",
    error: "bg-destructive/10 text-destructive",
    warning: "bg-warning/15 text-warning",
    info: "bg-muted text-foreground-soft",
  } as const

  return <span className={`${iconChip} ${tones[tone]}`}>{children}</span>
}

const Toaster = ({ toastOptions, ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme()
  const pathname = usePathname()

  // The signed-in app shows a floating bottom navigation below `lg`; the
  // `oa-toaster-above-nav` rule in globals.css lifts toasts clear of it.
  const hasBottomNav =
    pathname.startsWith("/dashboard") || pathname.startsWith("/admin")

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      position="bottom-right"
      duration={5000}
      visibleToasts={3}
      offset={{ bottom: "1.5rem", right: "1.5rem" }}
      mobileOffset={{ bottom: "1rem", left: "0.75rem", right: "0.75rem" }}
      className={hasBottomNav ? "oa-toaster oa-toaster-above-nav" : "oa-toaster"}
      icons={{
        success: (
          <ToastIcon tone="success">
            <CircleCheckIcon aria-hidden="true" />
          </ToastIcon>
        ),
        info: (
          <ToastIcon tone="info">
            <InfoIcon aria-hidden="true" />
          </ToastIcon>
        ),
        warning: (
          <ToastIcon tone="warning">
            <TriangleAlertIcon aria-hidden="true" />
          </ToastIcon>
        ),
        error: (
          <ToastIcon tone="error">
            <OctagonXIcon aria-hidden="true" />
          </ToastIcon>
        ),
        loading: (
          <ToastIcon tone="info">
            <Loader2Icon className="animate-spin" aria-hidden="true" />
          </ToastIcon>
        ),
      }}
      style={{ "--width": "23rem" } as React.CSSProperties}
      toastOptions={{
        unstyled: true,
        ...toastOptions,
        classNames: { ...toastClassNames, ...toastOptions?.classNames },
      }}
      {...props}
    />
  )
}

export { Toaster }
