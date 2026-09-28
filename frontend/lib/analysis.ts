import { apiFetch } from "@/lib/api";
import type { AnalysisQueue } from "@/lib/analysis-progress";
import { createClient as createBrowserSupabaseClient } from "@/lib/supabase/client";

export type Movement = {
  id: string;
  slug: string;
  name: string;
  family_key: string;
  illustration_url: string | null;
  upload_analysis_supported: boolean;
};

export type Safety = {
  notice: string | null;
  stressed_areas: string[] | null;
  prerequisites: string[] | null;
  cautions: string[] | null;
  stop_conditions: string[] | null;
  easier_option: string | null;
  setup: string[] | null;
};

export type MovementGuide = Movement & {
  documentation: {
    id: string;
    content: Safety;
  };
};

export type GuestConfig = {
  allowed_content_types: string[];
  max_size_bytes: number;
  max_duration_seconds: number;
  authenticated_max_size_bytes: number;
  authenticated_max_duration_seconds: number;
  safety_ack_version: string;
};

export type GuestAccess = {
  analysis_id: string;
  credential: string;
  access_expires_at: string;
};

export type AnalysisStatus =
  | "reserved"
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "expired";

export type AnalysisOutcome =
  | "completed"
  | "zero_valid_reps"
  | "insufficient_evidence";

export type RepOutcome = "valid" | "partial" | "uncertain";

export type ExecutionIntent =
  | "normal_training"
  | "explosive_power"
  | "controlled_tempo"
  | "max_test"
  | "technique_check";

export type TargetDeviation = {
  dimension: string;
  expected: string;
  detected: string;
};

export type Rep = {
  rep_index: number;
  outcome: RepOutcome;
  start_ms: number;
  end_ms: number;
  top_ms: number | null;
  phase_events: {
    phase: string;
    timestamp_ms: number;
  }[];
  reason_codes: string[];
  variations: {
    movement?: string;
    grip_orientation?: string;
    base_movement?: string;
    grip_width?: string;
    pull_height?: string;
  };
  target_match?: boolean | null;
  target_deviations?: TargetDeviation[];
  form_quality: Record<string, string | number | null>;
  technique_findings: string[];
  tempo: {
    ascent_ms?: number | null;
    top_transition_ms?: number | null;
    descent_ms?: number | null;
    total_ms?: number | null;
    descent_control?: string;
    descent_monotonic_ratio?: number | null;
  };
};

export type RepClassification = Pick<
  Rep,
  "rep_index" | "outcome" | "variations" | "target_match" | "target_deviations"
>;

export type DeterministicResult = {
  outcome: AnalysisOutcome;
  duration_ms: number;
  valid_rep_count: number;
  partial_rep_count: number;
  uncertain_rep_count: number;
  reps: Rep[];
  execution_intent: ExecutionIntent;
  set_summary: {
    finding_reps?: Record<string, number[]>;
    positive_patterns?: string[];
    deterioration_patterns?: string[];
    next_set_focus?: string;
    tempo?: Record<string, string | number | null>;
  };
  evidence: {
    total_sampled_frames: number;
    usable_pose_frames: number;
    usable_pose_ratio: number;
    hang_confirmed: boolean;
    reason_codes: string[];
  };
};

export type ExplanationStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "skipped";

export type GroundedText = {
  text: string;
  evidence: string[];
};

export type AnalysisExplanation = {
  summary: GroundedText;
  uncertainty_note?: GroundedText | null;
  key_findings: GroundedText[];
  next_set_focus: GroundedText;
  safety_note: GroundedText | null;
};

export type GuestResult = {
  analysis_id: string;
  status: AnalysisStatus;
  stage: string;
  movement: {
    id: string | null;
    slug: string;
    name: string;
    safety: Safety;
  };
  result: DeterministicResult | null;
  explanation_status: ExplanationStatus;
  explanation: AnalysisExplanation | null;
  explanation_retry_available: boolean;
};

function authorization(credential: string): HeadersInit {
  return {
    Authorization: `Bearer ${credential}`,
  };
}

export function reserveGuestAnalysis(
  movementId: string | null,
  safetyDocumentationId: string,
  safetyAckVersion: string,
  executionIntent: ExecutionIntent,
  guestCredential?: string | null,
) {
  return apiFetch<GuestAccess>("/analyses/guest", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": crypto.randomUUID(),
      ...(guestCredential ? { "Guest-Credential": guestCredential } : {}),
    },
    body: JSON.stringify({
      ...(movementId
        ? { movement_id: movementId }
        : { family_key: "vertical_pull" }),
      safety_documentation_id: safetyDocumentationId,
      safety_ack_version: safetyAckVersion,
      execution_intent: executionIntent,
    }),
  });
}

type UploadAuthorization = {
  bucket: string;
  path: string;
  token: string;
  max_size_bytes: number;
  allowed_content_types: string[];
};

export async function uploadGuestVideo(access: GuestAccess, file: File) {
  const upload = await apiFetch<UploadAuthorization>(
    `/analyses/${access.analysis_id}/upload`,
    {
      method: "POST",
      headers: authorization(access.credential),
    },
  );

  const contentType = file.type.split(";", 1)[0].toLowerCase();
  if (file.size > upload.max_size_bytes || !upload.allowed_content_types.includes(contentType)) {
    throw new Error("This video does not meet the upload requirements.");
  }

  const supabase = createBrowserSupabaseClient();

  const { error } = await supabase.storage
    .from(upload.bucket)
    .uploadToSignedUrl(upload.path, upload.token, file, {
      contentType,
    });

  if (error) {
    throw new Error(error.message);
  }

  await apiFetch(`/analyses/${access.analysis_id}/finalize`, {
    method: "POST",
    headers: authorization(access.credential),
  });
}

export type AnalysisStatusSnapshot = {
  status: AnalysisStatus;
  stage: string;
  // Present while the analysis is queued or running.
  queue?: AnalysisQueue | null;
};

export const getGuestStatus = (access: GuestAccess) =>
  apiFetch<AnalysisStatusSnapshot>(`/analyses/${access.analysis_id}/status`, {
    headers: authorization(access.credential),
    cache: "no-store",
  });

export const getGuestResult = (access: GuestAccess) =>
  apiFetch<GuestResult>(`/analyses/${access.analysis_id}/result`, {
    headers: authorization(access.credential),
    cache: "no-store",
  });
