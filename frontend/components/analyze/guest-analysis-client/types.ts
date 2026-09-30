import type { ReactNode } from "react";

import type { AuthenticatedAnalysisAccess } from "@/features/analysis/types";
import type {
  AnalysisStatus,
  GuestAccess,
  GuestResult,
  RepClassification,
  ExecutionIntent,
} from "@/lib/analysis";
import type {
  AnalysisQueue,
  AnalysisServiceState,
} from "@/lib/analysis-progress";

export type SelectedMovement = {
  id: string | null;
  name: string;
  slug: string;
  illustrationUrl: string | null;
  safetyDocumentationId: string;
};

export type UploadConfig = {
  maxSizeBytes: number;
  maxDurationSeconds: number;
  safetyAckVersion: string;
};

export type Step =
  | "video"
  | "ready"
  | "restoring"
  | "unavailable"
  | "processing"
  | "results";

export type RecoveryIssue = "missing" | "invalid" | null;
export type AnalysisAccess = GuestAccess | AuthenticatedAnalysisAccess;
export type VideoChoice = "record" | null;
export type StreamConnection = "connecting" | "live" | "reconnecting";

export type GuestAnalysisClientProps = {
  analysisId: string | null;
  movement: SelectedMovement;
  config: UploadConfig;
  safetyGuidance: ReactNode;
  authenticated?: boolean;
};

export type AnalysisControllerState = {
  step: Step;
  file: File | null;
  videoUrl: string | null;
  duration: number | null;
  acknowledged: boolean;
  executionIntent: ExecutionIntent;
  access: AnalysisAccess | null;
  status: AnalysisStatus;
  observing: boolean;
  connection: StreamConnection;
  stage: string;
  queue: AnalysisQueue | null;
  serviceState: AnalysisServiceState | null;
  newAnalysisBlocked: boolean;
  reps: RepClassification[];
  result: GuestResult | null;
  error: string | null;
  storageWarning: boolean;
  recoveryIssue: RecoveryIssue;
  videoChoice: VideoChoice;
  progressTitle: string;
  progressDescription: string;
};
