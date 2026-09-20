from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

from app.schemas.analysis_explanation import AnalysisExplanation
from app.schemas.movement_safety import MovementSafetyContentDraft


class GuestAnalysisReservationRequest(BaseModel):
    movement_id: uuid.UUID
    safety_documentation_id: uuid.UUID
    safety_ack_version: str


class GuestAnalysisConfigResponse(BaseModel):
    allowed_content_types: list[str]
    max_size_bytes: int
    max_duration_seconds: int
    safety_ack_version: str


class GuestAnalysisReservationResponse(BaseModel):
    analysis_id: uuid.UUID
    credential: str
    credential_type: Literal["Bearer"] = "Bearer"
    status: Literal["reserved"] = "reserved"
    reservation_expires_at: datetime
    access_expires_at: datetime


class GuestAnalysisUploadAuthorizationResponse(BaseModel):
    analysis_id: uuid.UUID
    bucket: str
    path: str
    token: str
    max_size_bytes: int
    allowed_content_types: list[str]


class GuestAnalysisFinalizeResponse(BaseModel):
    analysis_id: uuid.UUID
    video_path: str
    status: Literal["queued"] = "queued"
    stage: Literal["queued"] = "queued"


class GuestAnalysisStatusResponse(BaseModel):
    analysis_id: uuid.UUID
    status: str
    stage: str


class AnalysisPhaseRead(BaseModel):
    phase: str
    timestamp_ms: int


class AnalysisRepRead(BaseModel):
    rep_index: int
    outcome: Literal["valid", "partial", "uncertain"]
    start_ms: int
    end_ms: int
    top_ms: int | None = None
    phase_events: list[AnalysisPhaseRead] = Field(default_factory=list)
    reason_codes: list[str] = Field(default_factory=list)
    variations: dict[str, str] = Field(default_factory=dict)


class AnalysisEvidenceRead(BaseModel):
    total_sampled_frames: int
    usable_pose_frames: int
    usable_pose_ratio: float
    hang_confirmed: bool
    reason_codes: list[str] = Field(default_factory=list)


class DeterministicAnalysisRead(BaseModel):
    outcome: Literal["completed", "zero_valid_reps", "insufficient_evidence"]
    duration_ms: int
    valid_rep_count: int
    partial_rep_count: int
    uncertain_rep_count: int
    reps: list[AnalysisRepRead]
    evidence: AnalysisEvidenceRead


class GuestAnalysisMovementRead(BaseModel):
    id: uuid.UUID
    slug: str
    name: str
    safety: MovementSafetyContentDraft


class GuestAnalysisResultResponse(BaseModel):
    analysis_id: uuid.UUID
    status: str
    stage: str
    movement: GuestAnalysisMovementRead
    result: DeterministicAnalysisRead | None = None
    explanation_status: Literal["pending", "running", "completed", "failed", "skipped"]
    explanation: AnalysisExplanation | None = None
    explanation_retry_available: bool = False


class GuestExplanationRetryResponse(BaseModel):
    explanation_status: Literal["pending", "running"]
