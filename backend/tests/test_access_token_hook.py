from __future__ import annotations

import json
import runpy
import uuid
from datetime import UTC, datetime
from pathlib import Path

import pytest
from alembic.operations import Operations
from alembic.runtime.migration import MigrationContext
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.models.profile import Profile


@pytest.fixture(autouse=True)
def migrated_hook(db: Session) -> None:
    migration = (
        Path(__file__).resolve().parents[1]
        / "alembic/versions/71c4ea9b20d5_add_app_role_to_access_token_hook.py"
    )
    upgrade = runpy.run_path(str(migration))["upgrade"]
    with Operations.context(MigrationContext.configure(db.connection())):
        upgrade()


def hook_claims(db: Session, user_id: uuid.UUID) -> dict:
    event = {
        "user_id": str(user_id),
        "claims": {"role": "authenticated", "aud": "authenticated"},
    }
    result = db.scalar(
        text("SELECT public.open_ascent_access_token_hook(CAST(:event AS jsonb))"),
        {"event": json.dumps(event)},
    )
    return result["claims"]


def test_access_token_hook_uses_profile_role_and_preserves_supabase_role(
    db: Session,
) -> None:
    user_id = uuid.uuid4()
    db.execute(text("INSERT INTO auth.users (id) VALUES (:id)"), {"id": user_id})
    profile = Profile(
        id=user_id,
        display_name="Hook Test Athlete",
        app_role="athlete",
    )
    db.add(profile)
    db.flush()

    claims = hook_claims(db, user_id)
    assert claims["role"] == "authenticated"
    assert claims["aud"] == "authenticated"
    assert claims["onboarding_complete"] is False
    assert claims["user_role"] == "athlete"

    profile.app_role = "admin"
    profile.onboarding_completed_at = datetime.now(UTC)
    db.flush()

    claims = hook_claims(db, user_id)
    assert claims["role"] == "authenticated"
    assert claims["onboarding_complete"] is True
    assert claims["user_role"] == "admin"


def test_access_token_hook_fails_closed_without_profile(db: Session) -> None:
    claims = hook_claims(db, uuid.uuid4())
    assert claims["role"] == "authenticated"
    assert claims["onboarding_complete"] is False
    assert claims["user_role"] is None
