import type {
  Difficulty,
  MovementListItem,
} from "@/features/admin/movements/types";

export type { Difficulty } from "@/features/admin/movements/types";

export type DocumentationStatus = "draft" | "published" | "archived";

export type MovementSafetyContent = {
  notice?: string | null;
  difficulty?: Difficulty | null;
  stressed_areas?: string[] | null;
  prerequisites?: string[] | null;
  cautions?: string[] | null;
  stop_conditions?: string[] | null;
  easier_option?: string | null;
  setup?: string[] | null;
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

export type AdminDocumentationRecord = MovementDocumentation & {
  movement: MovementListItem;
};
