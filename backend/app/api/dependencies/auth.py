from __future__ import annotations

from typing import Annotated

from app.core.supabase import supabase
from app.db.database import DbSession
from app.models.profile import Profile
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select

bearer_scheme = HTTPBearer(auto_error=False)


def get_current_profile(
    credentials: Annotated[
        HTTPAuthorizationCredentials | None,
        Depends(bearer_scheme),
    ],
    db: DbSession,
) -> Profile:
    if credentials is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required.",
        )

    token = credentials.credentials

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

    profile = db.scalar(select(Profile).where(Profile.id == user.id))

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
