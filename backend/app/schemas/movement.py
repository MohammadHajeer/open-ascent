from __future__ import annotations

import uuid

from pydantic import BaseModel

from app.schemas.movement_documentation import MovementDocumentationRead
from app.schemas.movement_safety import Difficulty


class MovementListItemRead(BaseModel):
    id: uuid.UUID
    slug: str
    name: str
    family_key: str
    difficulty: Difficulty
    illustration_url: str | None
    upload_analysis_supported: bool
    live_coach_supported: bool


class MovementGuideRead(BaseModel):
    id: uuid.UUID
    slug: str
    name: str
    family_key: str

    illustration_url: str | None

    upload_analysis_supported: bool
    live_coach_supported: bool

    documentation: MovementDocumentationRead
