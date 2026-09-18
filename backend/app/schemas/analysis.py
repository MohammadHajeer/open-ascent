from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel


class GuestAnalysisReservationRequest(BaseModel):
    movement_id: uuid.UUID
    safety_documentation_id: uuid.UUID
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
