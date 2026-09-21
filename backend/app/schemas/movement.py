from __future__ import annotations

import uuid
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

from app.schemas.movement_documentation import MovementDocumentationRead
from app.schemas.movement_safety import Difficulty

MovementName = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=1, max_length=120),
]
MovementSlug = Annotated[
    str,
    StringConstraints(
        strip_whitespace=True,
        min_length=1,
        max_length=100,
        pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$",
    ),
]
MovementFamilyKey = Annotated[
    str,
    StringConstraints(
        strip_whitespace=True,
        min_length=1,
        max_length=100,
        pattern=r"^[a-z][a-z0-9_-]*$",
    ),
]
IllustrationPath = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=1, max_length=255),
]


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


class MovementAdminRead(BaseModel):
    id: uuid.UUID
    slug: str
    name: str
    family_key: str
    illustration_path: str | None
    illustration_url: str | None
    upload_analysis_supported: bool
    live_coach_supported: bool
    difficulty: Difficulty | None
    published_documentation_id: uuid.UUID | None
    published_documentation_version: int | None


class MovementCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: MovementName
    slug: MovementSlug
    family_key: MovementFamilyKey
    illustration_path: IllustrationPath | None = None
    upload_analysis_supported: bool = Field(default=False)
    live_coach_supported: bool = Field(default=False)


class MovementUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: MovementName | None = None
    slug: MovementSlug | None = None
    family_key: MovementFamilyKey | None = None
    illustration_path: IllustrationPath | None = None
    upload_analysis_supported: bool | None = None
    live_coach_supported: bool | None = None
