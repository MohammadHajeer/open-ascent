export type DashboardMode = "user" | "admin";

export type DashboardNavIcon =
  | "overview"
  | "analyses"
  | "analyze"
  | "profile"
  | "settings"
  | "movements"
  | "documentation"
  | "users";

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
    label: "Analyses",
    href: "/dashboard/analyses",
    icon: "analyses",
  },
  {
    label: "Analyze",
    href: "/analyze",
    icon: "analyze",
    emphasis: true,
  },
  {
    label: "Profile",
    href: "/dashboard/profile",
    icon: "profile",
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

  return current?.label ?? (mode === "admin" ? "Admin" : "Dashboard");
}
