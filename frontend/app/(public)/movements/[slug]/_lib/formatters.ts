import type { MovementDifficulty } from "./types";

export function formatFamilyLabel(familyKey: string) {
  return familyKey
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export function formatDifficulty(difficulty: MovementDifficulty) {
  return difficulty.charAt(0).toUpperCase() + difficulty.slice(1);
}
