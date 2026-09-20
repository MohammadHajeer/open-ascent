export type RouteDestination = "/login" | "/onboarding" | "/dashboard";

function routeKind(pathname: string) {
  const path = pathname.replace(/\/+$/, "") || "/";
  if (path === "/dashboard" || path.startsWith("/dashboard/")) {
    return "dashboard";
  }
  if (path === "/onboarding") return "onboarding";
  if (path === "/login" || path === "/signup") return "auth";
  return null;
}

export function isSessionRoutedPath(pathname: string): boolean {
  return routeKind(pathname) !== null;
}

export function routeDestination(
  pathname: string,
  claims: object | null,
): RouteDestination | null {
  const kind = routeKind(pathname);
  if (!kind) return null;
  if (!claims) return kind === "auth" ? null : "/login";
  if (
    !("onboarding_complete" in claims) ||
    claims.onboarding_complete !== true
  ) {
    return kind === "onboarding" ? null : "/onboarding";
  }
  return kind === "dashboard" ? null : "/dashboard";
}
