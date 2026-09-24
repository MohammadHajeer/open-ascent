export type EffectivePlan = "free" | "pro";

export type SubscriptionStatus = {
  effective_plan: EffectivePlan;
  pro_price: { unit_amount: number; currency: string; interval: "month" };
  subscription_status: string | null;
  cancel_at_period_end: boolean;
  current_period_end: string | null;
  can_cancel: boolean;
};

export type LiveCoachAccess = {
  allowed: boolean;
};

export type CheckoutSession = {
  url: string;
};
