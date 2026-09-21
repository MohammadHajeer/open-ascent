export type UserRole = "athlete" | "admin" | null;
export type EffectivePlan = "free" | "pro";

export type AuthClaims = {
  user_role?: unknown;
  onboarding_complete?: unknown;
  effective_plan?: unknown;
  [key: string]: unknown;
};

function asClaims(value: unknown): AuthClaims | null {
  return value !== null && typeof value === "object"
    ? (value as AuthClaims)
    : null;
}

export function getUserRole(claims: unknown): UserRole {
  const value = asClaims(claims)?.user_role;
  return value === "admin" || value === "athlete" ? value : null;
}

export function isOnboardingComplete(claims: unknown): boolean {
  return asClaims(claims)?.onboarding_complete === true;
}

/** Presentation-only snapshot. Backend entitlements must resolve from DB state. */
export function getEffectivePlan(claims: unknown): EffectivePlan {
  return asClaims(claims)?.effective_plan === "pro" ? "pro" : "free";
}

export function parseAccessTokenClaims(accessToken: string): AuthClaims | null {
  try {
    const payload = accessToken.split(".")[1];
    if (!payload) return null;
    const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
    return asClaims(JSON.parse(atob(padded)));
  } catch {
    return null;
  }
}
