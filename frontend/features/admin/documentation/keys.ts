export const adminDocumentationKeys = {
  all: ["admin", "documentation"] as const,
  lists: () => ["admin", "documentation", "list"] as const,
  detail: (id: string) => ["admin", "documentation", "detail", id] as const,
  byMovement: (movementId: string) =>
    ["admin", "documentation", "movement", movementId] as const,
};
