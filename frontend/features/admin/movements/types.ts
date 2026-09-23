export type Difficulty = "beginner" | "intermediate" | "advanced";
export type PrescriptionType = "repetitions" | "duration";

export type MovementAdminRead = {
  id: string;
  slug: string;
  name: string;
  family_key: string;
  prescription_type: PrescriptionType | null;
  illustration_path: string | null;
  illustration_url: string | null;
  upload_analysis_supported: boolean;
  live_coach_supported: boolean;
  difficulty: Difficulty | null;
  published_documentation_id: string | null;
  published_documentation_version: number | null;
};

export type MovementListItem = MovementAdminRead;
export type MovementGuide = MovementAdminRead;

export type MovementCreateInput = {
  name: string;
  slug: string;
  family_key: string;
  prescription_type: PrescriptionType;
  illustration_path?: string | null;
  upload_analysis_supported: boolean;
  live_coach_supported: boolean;
};

export type MovementUpdateInput = Partial<MovementCreateInput>;
