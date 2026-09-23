export type DashboardMode = "user" | "admin";

export type DashboardNavIcon =
  | "overview"
  | "train"
  | "progress"
  | "coach"
  | "library"
  | "analyses"
  | "analyze"
  | "profile"
  | "settings"
  | "movements"
  | "documentation"
  | "users"
  | "usage"
  | "plans";

export type DashboardNavItem = {
  label: string;
  href: string;
  icon: DashboardNavIcon;
  exact?: boolean;
  emphasis?: boolean;
};

export const userNavigation: DashboardNavItem[] = [
  {
    label: "Overview",
    href: "/dashboard",
    icon: "overview",
    exact: true,
  },
  {
    label: "Train",
    href: "/dashboard/train",
    icon: "train",
  },
  {
    label: "Progress",
    href: "/dashboard/progress",
    icon: "progress",
  },
  {
    label: "AI Coach",
    href: "/dashboard/coach",
    icon: "coach",
  },
  {
    label: "Library",
    href: "/dashboard/library",
    icon: "library",
  },
  {
    label: "Analyses",
    href: "/dashboard/analyses",
    icon: "analyses",
  },
  {
    label: "Settings",
    href: "/dashboard/settings",
    icon: "settings",
  },
];

export const adminNavigation: DashboardNavItem[] = [
  {
    label: "Overview",
    href: "/admin",
    icon: "overview",
    exact: true,
  },
  {
    label: "Analyses",
    href: "/admin/analyses",
    icon: "analyses",
  },
  {
    label: "Usage",
    href: "/admin/usage",
    icon: "usage",
  },
  {
    label: "Plans",
    href: "/admin/plans",
    icon: "plans",
  },
  {
    label: "Movements",
    href: "/admin/movements",
    icon: "movements",
  },
  {
    label: "Documentation",
    href: "/admin/documentation",
    icon: "documentation",
  },
  {
    label: "Users",
    href: "/admin/users",
    icon: "users",
  },
];

export function getNavigation(mode: DashboardMode) {
  return mode === "admin" ? adminNavigation : userNavigation;
}

export function isNavigationItemActive(
  pathname: string,
  item: DashboardNavItem,
) {
  if (item.exact) {
    return pathname === item.href;
  }

  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}

export function getCurrentNavigationLabel(
  pathname: string,
  mode: DashboardMode,
) {
  const navigation = getNavigation(mode);

  const current = [...navigation]
    .sort((a, b) => b.href.length - a.href.length)
    .find((item) => isNavigationItemActive(pathname, item));

  if (current) return current.label;
  if (mode === "user") {
    if (pathname === "/analyze") return "Analyze movement";
    if (pathname.startsWith("/dashboard/analyses")) return "Analyses";
    if (pathname.startsWith("/dashboard/profile")) return "Profile";
  }

  return mode === "admin" ? "Admin" : "Dashboard";
}
