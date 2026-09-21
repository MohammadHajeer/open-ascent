export const subscriptionKeys = {
  all: ["subscription"] as const,
  status: () => [...subscriptionKeys.all, "status"] as const,
};

