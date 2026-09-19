export type MovementGroup<T> = {
  familyKey: string;
  movements: T[];
};

export function groupSupportedMovements<T extends {
  family_key: string;
  upload_analysis_supported: boolean;
}>(movements: readonly T[]): MovementGroup<T>[] {
  const groups = new Map<string, T[]>();
  for (const movement of movements) {
    if (!movement.upload_analysis_supported) continue;
    const family = groups.get(movement.family_key) ?? [];
    family.push(movement);
    groups.set(movement.family_key, family);
  }
  return Array.from(groups, ([familyKey, familyMovements]) => ({
    familyKey,
    movements: familyMovements,
  }));
}

export function movementFamilyLabel(familyKey: string) {
  return familyKey
    .split("_")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}
