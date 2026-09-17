from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.movement_safety import MovementSafetyContentDraft


class MovementDocumentationCreate(BaseModel):
    content: MovementSafetyContentDraft = Field(
        default_factory=MovementSafetyContentDraft
    )


class MovementDocumentationUpdate(BaseModel):
    content: MovementSafetyContentDraft


class MovementDocumentationRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    movement_id: uuid.UUID
    version: int
    status: str
    content: MovementSafetyContentDraft

    created_by: uuid.UUID | None
    published_by: uuid.UUID | None
    published_at: datetime | None

    edit_revision: int

    created_at: datetime
    updated_at: datetime
