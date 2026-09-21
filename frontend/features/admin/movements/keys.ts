export const adminMovementKeys = {
  all: ["admin", "movements"] as const,
  detail: (slug: string) => ["admin", "movements", "detail", slug] as const,
};
