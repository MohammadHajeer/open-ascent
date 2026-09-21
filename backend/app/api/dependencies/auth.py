from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select

from app.core.supabase import supabase
from app.db.database import DbSession
from app.models.profile import Profile

bearer_scheme = HTTPBearer(auto_error=False)


def verify_access_token(token: str) -> uuid.UUID:
    """Return the verified Supabase principal for a raw access token."""
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required.",
        )

    try:
        response = supabase.auth.get_user(token)
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired access token.",
        ) from exc

    user = response.user

    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired access token.",
        )

    try:
        return uuid.UUID(str(user.id))
    except (TypeError, ValueError) as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired access token.",
        ) from exc


def get_current_user_id(
    credentials: Annotated[
        HTTPAuthorizationCredentials | None,
        Depends(bearer_scheme),
    ],
) -> uuid.UUID:
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required.",
        )

    return verify_access_token(credentials.credentials)


CurrentUserId = Annotated[uuid.UUID, Depends(get_current_user_id)]


def get_current_profile(user_id: CurrentUserId, db: DbSession) -> Profile:
    profile = db.scalar(select(Profile).where(Profile.id == user_id))

    if profile is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User profile is not available.",
        )

    return profile


CurrentProfile = Annotated[
    Profile,
    Depends(get_current_profile),
]


def require_admin(
    profile: CurrentProfile,
) -> Profile:
    if profile.app_role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin access required.",
        )

    return profile


AdminProfile = Annotated[
    Profile,
    Depends(require_admin),
]


def require_athlete(
    profile: CurrentProfile,
) -> Profile:
    if profile.app_role != "athlete":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Athlete access required.",
        )

    return profile


AthleteProfile = Annotated[
    Profile,
    Depends(require_athlete),
]
