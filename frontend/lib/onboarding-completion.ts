import {
  getEffectivePlan,
  isOnboardingComplete,
  parseAccessTokenClaims,
  type EffectivePlan,
} from "./supabase/claims.ts";

export function hasCompletedOnboardingClaim(accessToken: string): boolean {
  return isOnboardingComplete(parseAccessTokenClaims(accessToken));
}

export function getEffectivePlanFromAccessToken(accessToken: string): EffectivePlan {
  return getEffectivePlan(parseAccessTokenClaims(accessToken));
}

export async function completeOnboardingFlow(actions: {
  submit: () => Promise<unknown>;
  refreshSession: () => Promise<string | null>;
  replace: (path: "/dashboard") => void;
  refreshRouter: () => void;
}): Promise<void> {
  await actions.submit();
  const accessToken = await actions.refreshSession();
  if (!accessToken || !hasCompletedOnboardingClaim(accessToken)) {
    throw new Error(
      "Your profile was saved, but your session has not updated yet. Try again.",
    );
  }
  actions.replace("/dashboard");
  actions.refreshRouter();
}
