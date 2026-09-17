export type MovementDifficulty = "beginner" | "intermediate" | "advanced";

export type MovementSafetyContent = {
  notice: string;
  difficulty: MovementDifficulty;
  stressed_areas: string[];
  prerequisites: string[];
  cautions: string[];
  stop_conditions: string[];
  easier_option: string | null;
  setup: string[] | null;
};

export type MovementGuide = {
  id: string;
  slug: string;
  name: string;
  family_key: string;
  illustration_url: string | null;
  upload_analysis_supported: boolean;
  live_coach_supported: boolean;
  documentation: {
    id: string;
    movement_id: string;
    version: number;
    status: "published";
    content: MovementSafetyContent;
    published_at: string | null;
    edit_revision: number;
  };
};
