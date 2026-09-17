from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class MovementDocumentationCreate(BaseModel):
    content: dict[str, Any] = Field(default_factory=dict)


class MovementDocumentationUpdate(BaseModel):
    content: dict[str, Any]


class MovementDocumentationRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    movement_id: uuid.UUID
    version: int
    status: str
    content: dict[str, Any]

    created_by: uuid.UUID | None
    published_by: uuid.UUID | None
    published_at: datetime | None

    edit_revision: int

    created_at: datetime
    updated_at: datetime
