import type { Difficulty } from "@/features/admin/movements/types";

export type { Difficulty } from "@/features/admin/movements/types";

export type DocumentationStatus = "draft" | "published" | "archived";

export type ReadinessPerformanceRule = {
  code: string;
  type: "movement_performance";
  prerequisite_index: number;
  movement_id: string;
  metric: "reps" | "hold_seconds";
  operator: ">=";
  value: number | string;
  max_age_days: number;
  accepted_sources: Array<
    "uploaded_analysis" | "live_coach" | "manual" | "self_reported" | "initial_assessment"
  >;
};

export type MovementSafetyContent = {
  notice?: string | null;
  difficulty?: Difficulty | null;
  stressed_areas?: string[] | null;
  prerequisites?: string[] | null;
  cautions?: string[] | null;
  stop_conditions?: string[] | null;
  easier_option?: string | null;
  setup?: string[] | null;
  readiness_rules?: ReadinessPerformanceRule[] | null;
};

export type MovementDocumentation = {
  id: string;
  movement_id: string;
  version: number;
  status: DocumentationStatus;
  content: MovementSafetyContent;
  created_by: string | null;
  published_by: string | null;
  published_at: string | null;
  edit_revision: number;
  created_at: string;
  updated_at: string;
};

export type DocumentationMovement = { id: string; name: string; slug: string; family_key: string };
export type AdminDocumentationRecord = MovementDocumentation & { movement: DocumentationMovement };
export type AdminDocumentationSummary = Pick<MovementDocumentation, "id" | "movement_id" | "version" | "status" | "edit_revision" | "updated_at" | "published_at"> & { movement: DocumentationMovement };
export type DocumentationPage = { page: number; page_size: number; total: number; items: AdminDocumentationSummary[] };
