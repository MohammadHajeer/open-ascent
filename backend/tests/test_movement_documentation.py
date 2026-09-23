from __future__ import annotations

import uuid

import pytest
from pydantic import ValidationError
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.models.movement import Movement
from app.models.profile import Profile
from app.schemas.movement_documentation import (
    MovementDocumentationCreate,
    MovementDocumentationUpdate,
)
from app.schemas.movement_safety import MovementSafetyContentDraft
from app.services.movement_documentation import (
    DraftAlreadyExistsError,
    ImmutableDocumentationError,
    InvalidSafetyContentError,
    MovementDocumentationService,
)


@pytest.fixture
def auth_user_id(db: Session) -> uuid.UUID:
    # Fake Auth provisioning in the CI database; the profile FK stays real.
    user_id = uuid.uuid4()
    db.execute(text("INSERT INTO auth.users (id) VALUES (:id)"), {"id": user_id})
    return user_id


@pytest.fixture
def admin_profile(
    db: Session,
    auth_user_id: uuid.UUID,
) -> Profile:
    profile = Profile(
        id=auth_user_id,
        display_name="Safety Test Admin",
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
        "notice": "Perform the movement with controlled technique.",
        "difficulty": "beginner",
        "stressed_areas": [
            "shoulders",
            "elbows",
        ],
        "prerequisites": [
            "Comfortable overhead position",
        ],
        "cautions": [
            "Avoid uncontrolled swinging",
        ],
        "stop_conditions": [
            "Sharp shoulder pain",
            "Loss of grip control",
        ],
        "easier_option": "Use an assisted variation.",
        "setup": [
            "Use stable equipment",
            "Ensure enough clearance",
        ],
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
    assert v1.content == v1_content

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
        **v1_content,
        "notice": "Updated safety notice.",
        "cautions": [
            "Avoid uncontrolled swinging",
            "Maintain controlled movement.",
        ],
    }

    v1 = MovementDocumentationService.update_draft(
        db=db,
        documentation_id=v1.id,
        payload=MovementDocumentationUpdate(
            edit_revision=v1.edit_revision,
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
                edit_revision=v1.edit_revision,
                content={
                    "notice": "This must not be allowed.",
                },
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

    # ---------------------------------------------------------
    # Partially update v2
    # ---------------------------------------------------------

    v2_updates = {
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
            edit_revision=v2.edit_revision,
            content=v2_updates,
        ),
    )

    expected_v2_content = {
        **updated_v1_content,
        **v2_updates,
    }

    db.refresh(v1)

    # PATCH-style update keeps fields that were not supplied.
    assert v2.content == expected_v2_content

    # Editing v2 must not modify already-published v1.
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
    assert v2.content == expected_v2_content

    # Archived versions are also immutable.

    with pytest.raises(ImmutableDocumentationError):
        MovementDocumentationService.update_draft(
            db=db,
            documentation_id=v1.id,
            payload=MovementDocumentationUpdate(
                edit_revision=v1.edit_revision,
                content={
                    "notice": "Archived content modification.",
                },
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


def test_incomplete_safety_documentation_cannot_be_published(
    db: Session,
    admin_profile: Profile,
    movement: Movement,
) -> None:
    draft = MovementDocumentationService.create_draft(
        db=db,
        movement_id=movement.id,
        payload=MovementDocumentationCreate(
            content={
                "notice": "This draft is still incomplete.",
            },
        ),
        actor_id=admin_profile.id,
    )

    assert draft.status == "draft"

    with pytest.raises(InvalidSafetyContentError):
        MovementDocumentationService.publish_draft(
            db=db,
            documentation_id=draft.id,
            actor_id=admin_profile.id,
        )

    db.refresh(draft)

    # Failed publication must leave the draft untouched.
    assert draft.status == "draft"
    assert draft.published_by is None
    assert draft.published_at is None


def test_safety_content_rejects_invalid_difficulty() -> None:
    with pytest.raises(ValidationError):
        MovementSafetyContentDraft(
            difficulty="extreme",
        )


def test_safety_content_rejects_unknown_fields() -> None:
    with pytest.raises(ValidationError):
        MovementSafetyContentDraft(
            notice="Valid notice.",
            random_field="This should not exist.",
        )
