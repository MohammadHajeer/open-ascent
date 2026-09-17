from __future__ import annotations

import uuid
from collections.abc import Generator

import pytest
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.supabase import supabase
from app.models.movement import Movement
from app.models.profile import Profile
from app.schemas.movement_documentation import (
    MovementDocumentationCreate,
    MovementDocumentationUpdate,
)
from app.services.movement_documentation import (
    DraftAlreadyExistsError,
    ImmutableDocumentationError,
    MovementDocumentationService,
)


@pytest.fixture(scope="module")
def auth_user_id() -> Generator[uuid.UUID, None, None]:
    email = f"open-ascent-saf01-{uuid.uuid4().hex}@example.com"

    response = supabase.auth.admin.create_user(
        {
            "email": email,
            "email_confirm": True,
        }
    )

    if response.user is None:
        raise RuntimeError("Failed to create temporary Supabase Auth test user.")

    user_id = uuid.UUID(str(response.user.id))

    try:
        yield user_id
    finally:
        supabase.auth.admin.delete_user(str(user_id))


@pytest.fixture
def admin_profile(
    db: Session,
    auth_user_id: uuid.UUID,
) -> Profile:
    profile = Profile(
        id=auth_user_id,
        display_name="SAF-01 Test Admin",
        app_role="admin",
    )

    db.add(profile)
    db.flush()

    return profile


@pytest.fixture
def movement(db: Session) -> Movement:
    movement = Movement(
        slug=f"test-pull-up-{uuid.uuid4().hex}",
        name="Test Pull-Up",
        family_key="vertical_pull",
    )

    db.add(movement)
    db.flush()

    return movement


def test_database_connection(db: Session) -> None:
    result = db.scalar(text("SELECT 1"))

    assert result == 1


def test_movement_documentation_lifecycle(
    db: Session,
    admin_profile: Profile,
    movement: Movement,
) -> None:
    # ---------------------------------------------------------
    # v1 — create draft
    # ---------------------------------------------------------

    v1_content = {
        "notice": "Test safety notice.",
        "difficulty": "beginner",
        "cautions": ["Stop if you feel pain."],
    }

    v1 = MovementDocumentationService.create_draft(
        db=db,
        movement_id=movement.id,
        payload=MovementDocumentationCreate(
            content=v1_content,
        ),
        actor_id=admin_profile.id,
    )

    assert v1.version == 1
    assert v1.status == "draft"
    assert v1.edit_revision == 1
    assert v1.created_by == admin_profile.id
    assert v1.published_by is None
    assert v1.published_at is None

    # Only one draft may exist at a time.

    with pytest.raises(DraftAlreadyExistsError):
        MovementDocumentationService.create_draft(
            db=db,
            movement_id=movement.id,
            payload=MovementDocumentationCreate(
                content={"notice": "Another draft"},
            ),
            actor_id=admin_profile.id,
        )

    # ---------------------------------------------------------
    # v1 — edit draft
    # ---------------------------------------------------------

    updated_v1_content = {
        "notice": "Updated safety notice.",
        "difficulty": "beginner",
        "cautions": [
            "Stop if you feel pain.",
            "Maintain controlled movement.",
        ],
    }

    v1 = MovementDocumentationService.update_draft(
        db=db,
        documentation_id=v1.id,
        payload=MovementDocumentationUpdate(
            content=updated_v1_content,
        ),
    )

    assert v1.content == updated_v1_content
    assert v1.edit_revision == 2

    # ---------------------------------------------------------
    # v1 — publish
    # ---------------------------------------------------------

    v1 = MovementDocumentationService.publish_draft(
        db=db,
        documentation_id=v1.id,
        actor_id=admin_profile.id,
    )

    assert v1.status == "published"
    assert v1.published_by == admin_profile.id
    assert v1.published_at is not None

    published = MovementDocumentationService.get_published(
        db=db,
        movement_id=movement.id,
    )

    assert published is not None
    assert published.id == v1.id

    # Published documentation is immutable.

    with pytest.raises(ImmutableDocumentationError):
        MovementDocumentationService.update_draft(
            db=db,
            documentation_id=v1.id,
            payload=MovementDocumentationUpdate(
                content={"notice": "This must not be allowed."},
            ),
        )

    # ---------------------------------------------------------
    # Editing published documentation → v2 draft
    # ---------------------------------------------------------

    v2 = MovementDocumentationService.create_draft_from_published(
        db=db,
        movement_id=movement.id,
        actor_id=admin_profile.id,
    )

    assert v2.version == 2
    assert v2.status == "draft"
    assert v2.edit_revision == 1
    assert v2.content == updated_v1_content
    assert v2.created_by == admin_profile.id

    # Editing v2 must not modify v1.

    v2_content = {
        "notice": "Version 2 safety notice.",
        "difficulty": "intermediate",
        "cautions": [
            "Stop if you feel pain.",
            "Maintain controlled movement.",
        ],
    }

    v2 = MovementDocumentationService.update_draft(
        db=db,
        documentation_id=v2.id,
        payload=MovementDocumentationUpdate(
            content=v2_content,
        ),
    )

    db.refresh(v1)

    assert v2.content == v2_content
    assert v1.content == updated_v1_content

    # ---------------------------------------------------------
    # Publish v2
    # ---------------------------------------------------------

    v2 = MovementDocumentationService.publish_draft(
        db=db,
        documentation_id=v2.id,
        actor_id=admin_profile.id,
    )

    db.refresh(v1)

    assert v1.status == "archived"
    assert v2.status == "published"

    # Archived versions are also immutable.

    with pytest.raises(ImmutableDocumentationError):
        MovementDocumentationService.update_draft(
            db=db,
            documentation_id=v1.id,
            payload=MovementDocumentationUpdate(
                content={"notice": "Archived content modification."},
            ),
        )

    # ---------------------------------------------------------
    # Verify current state + history
    # ---------------------------------------------------------

    current = MovementDocumentationService.get_published(
        db=db,
        movement_id=movement.id,
    )

    assert current is not None
    assert current.id == v2.id

    draft = MovementDocumentationService.get_draft(
        db=db,
        movement_id=movement.id,
    )

    assert draft is None

    versions = MovementDocumentationService.list_versions(
        db=db,
        movement_id=movement.id,
    )

    assert [version.version for version in versions] == [2, 1]
    assert [version.status for version in versions] == [
        "published",
        "archived",
    ]
