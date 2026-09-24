export type EffectivePlan = "free" | "pro";

export type SubscriptionStatus = {
  effective_plan: EffectivePlan;
};

export type LiveCoachAccess = {
  allowed: boolean;
};

export type CheckoutSession = {
  url: string;
};
