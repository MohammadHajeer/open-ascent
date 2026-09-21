import type { MovementDocumentation } from "@/features/admin/documentation/types";

export type Difficulty = "beginner" | "intermediate" | "advanced";

export type MovementListItem = {
  id: string;
  slug: string;
  name: string;
  family_key: string;
  difficulty: Difficulty;
  illustration_url: string | null;
  upload_analysis_supported: boolean;
  live_coach_supported: boolean;
};

export type MovementGuide = MovementListItem & {
  documentation: MovementDocumentation;
};
