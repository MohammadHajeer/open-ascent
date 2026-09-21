export type EffectivePlan = "free" | "pro";

export type SubscriptionStatus = {
  effective_plan: EffectivePlan;
};

export type CheckoutSession = {
  url: string;
};

