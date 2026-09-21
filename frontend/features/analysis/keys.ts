export const analysisKeys = {
  all: ["analysis"] as const,
  history: (limit = 50) => ["analysis", "history", { limit }] as const,
  detail: (id: string) => ["analysis", "detail", id] as const,
  result: (id: string) => ["analysis", "result", id] as const,
};
