from __future__ import annotations

import uuid

from pydantic import BaseModel

from app.schemas.movement_documentation import MovementDocumentationRead


class MovementGuideRead(BaseModel):
    id: uuid.UUID
    slug: str
    name: str
    family_key: str

    illustration_url: str | None

    upload_analysis_supported: bool
    live_coach_supported: bool

    documentation: MovementDocumentationRead
