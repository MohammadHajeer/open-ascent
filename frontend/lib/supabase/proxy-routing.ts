export type RouteDestination = "/login" | "/onboarding" | "/dashboard" | "/admin";

function routeKind(pathname: string) {
  const path = pathname.replace(/\/+$/, "") || "/";
  if (path === "/admin" || path.startsWith("/admin/")) {
    return "admin";
  }
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

  const isAdmin = "user_role" in claims && claims.user_role === "admin";
  const onboardingComplete =
    "onboarding_complete" in claims && claims.onboarding_complete === true;

  if (isAdmin) {
    if (kind === "admin") return null;
    if (kind === "onboarding") return onboardingComplete ? "/admin" : null;
    if (kind === "dashboard") return onboardingComplete ? null : "/admin";
    return "/admin";
  }

  if (!onboardingComplete) {
    return kind === "onboarding" ? null : "/onboarding";
  }
  return kind === "dashboard" ? null : "/dashboard";
}
