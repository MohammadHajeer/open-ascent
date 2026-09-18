from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Annotated, NoReturn

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select

from app.core.config import settings
from app.core.guest_credentials import verify_guest_token
from app.db.database import DbSession
from app.models.analysis import Analysis

bearer_scheme = HTTPBearer(auto_error=False)


def _deny_guest_access() -> NoReturn:
    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid or expired analysis access.",
        headers={"WWW-Authenticate": "Bearer"},
    )


def require_guest_analysis_access(
    analysis_id: uuid.UUID,
    db: DbSession,
    credentials: Annotated[
        HTTPAuthorizationCredentials | None,
        Depends(bearer_scheme),
    ],
) -> Analysis:
    if credentials is None:
        _deny_guest_access()

    if credentials.scheme.lower() != "bearer":
        _deny_guest_access()

    analysis = db.scalar(
        select(Analysis).where(
            Analysis.id == analysis_id,
            Analysis.owner_kind == "guest",
        )
    )

    if analysis is None:
        _deny_guest_access()

    if analysis.guest_token_hash is None:
        _deny_guest_access()

    if (
        analysis.access_expires_at is None
        or analysis.access_expires_at <= datetime.now(UTC)
    ):
        _deny_guest_access()

    if not verify_guest_token(
        credentials.credentials,
        analysis.guest_token_hash,
        settings.guest_token_secret,
    ):
        _deny_guest_access()

    return analysis


GuestAnalysisAccess = Annotated[
    Analysis,
    Depends(require_guest_analysis_access),
]
