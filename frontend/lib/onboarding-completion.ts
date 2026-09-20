export function hasCompletedOnboardingClaim(accessToken: string): boolean {
  try {
    const payload = accessToken.split(".")[1];
    if (!payload) return false;
    const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const claims = JSON.parse(atob(base64)) as { onboarding_complete?: unknown };
    return claims.onboarding_complete === true;
  } catch {
    return false;
  }
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
