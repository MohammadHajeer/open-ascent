from __future__ import annotations

import uuid
from datetime import UTC, datetime

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.api.dependencies.auth import get_current_user_id
from app.main import app
from app.models.movement import Movement
from app.models.movement_documentation import MovementDocumentation
from app.models.profile import Profile


def bearer() -> dict[str, str]:
    return {"Authorization": "Bearer test-token"}


def create_profile(db: Session, role: str) -> Profile:
    user_id = uuid.uuid4()
    db.execute(text("INSERT INTO auth.users (id) VALUES (:id)"), {"id": user_id})
    profile = Profile(
        id=user_id,
        display_name=f"{role.title()} Movement Tester",
        app_role=role,
    )
    db.add(profile)
    db.flush()
    return profile


@pytest.fixture
def admin_client(client: TestClient, db: Session) -> TestClient:
    profile = create_profile(db, "admin")
    app.dependency_overrides[get_current_user_id] = lambda: profile.id
    yield client
    app.dependency_overrides.pop(get_current_user_id, None)


@pytest.fixture
def athlete_client(client: TestClient, db: Session) -> TestClient:
    profile = create_profile(db, "athlete")
    app.dependency_overrides[get_current_user_id] = lambda: profile.id
    yield client
    app.dependency_overrides.pop(get_current_user_id, None)


def movement_payload(slug: str = "new-admin-movement") -> dict[str, object]:
    return {
        "name": "New Admin Movement",
        "slug": slug,
        "family_key": "vertical_pull",
        "illustration_path": "new-admin-movement.png",
        "upload_analysis_supported": True,
        "live_coach_supported": False,
    }


def test_admin_can_create_and_list_movement(admin_client: TestClient) -> None:
    response = admin_client.post(
        "/movements", headers=bearer(), json=movement_payload()
    )

    assert response.status_code == 201
    created = response.json()
    assert created["name"] == "New Admin Movement"
    assert created["slug"] == "new-admin-movement"
    assert created["published_documentation_id"] is None

    listed = admin_client.get("/movements/admin", headers=bearer())
    assert listed.status_code == 200
    assert any(item["id"] == created["id"] for item in listed.json())


def test_non_admin_cannot_create_movement(athlete_client: TestClient) -> None:
    assert (
        athlete_client.post(
            "/movements",
            headers=bearer(),
            json=movement_payload("athlete-movement"),
        ).status_code
        == 403
    )


def test_unauthenticated_user_cannot_create_movement(client: TestClient) -> None:
    assert client.post("/movements", json=movement_payload()).status_code == 401


def test_non_admin_cannot_update_movement(
    athlete_client: TestClient,
    db: Session,
) -> None:
    movement = Movement(
        slug="protected-movement",
        name="Protected Movement",
        family_key="vertical_pull",
    )
    db.add(movement)
    db.flush()

    assert (
        athlete_client.patch(
            f"/movements/{movement.id}",
            headers=bearer(),
            json={"name": "Should not change"},
        ).status_code
        == 403
    )


def test_duplicate_slug_and_invalid_payload_are_rejected(
    admin_client: TestClient,
) -> None:
    first = admin_client.post(
        "/movements",
        headers=bearer(),
        json=movement_payload("duplicate-movement"),
    )
    duplicate = admin_client.post(
        "/movements",
        headers=bearer(),
        json=movement_payload("duplicate-movement"),
    )
    invalid = admin_client.post(
        "/movements",
        headers=bearer(),
        json={**movement_payload("Invalid Slug"), "name": " "},
    )

    assert first.status_code == 201
    assert duplicate.status_code == 409
    assert invalid.status_code == 422


def test_admin_can_patch_movement_and_preserve_untouched_fields(
    admin_client: TestClient,
) -> None:
    created = admin_client.post(
        "/movements",
        headers=bearer(),
        json=movement_payload("editable-movement"),
    ).json()

    response = admin_client.patch(
        f"/movements/{created['id']}",
        headers=bearer(),
        json={"name": "Updated Movement", "slug": "updated-movement"},
    )

    assert response.status_code == 200
    updated = response.json()
    assert updated["name"] == "Updated Movement"
    assert updated["slug"] == "updated-movement"
    assert updated["family_key"] == "vertical_pull"
    assert updated["upload_analysis_supported"] is True

    assert (
        admin_client.patch(
            f"/movements/{uuid.uuid4()}",
            headers=bearer(),
            json={"name": "Missing"},
        ).status_code
        == 404
    )
    assert (
        admin_client.patch(
            f"/movements/{created['id']}",
            headers=bearer(),
            json={"id": str(created["id"])},
        ).status_code
        == 422
    )


def test_public_movement_get_still_returns_published_guide(
    client: TestClient,
    db: Session,
) -> None:
    movement = Movement(
        slug="public-admin-regression",
        name="Public Admin Regression",
        family_key="vertical_pull",
    )
    db.add(movement)
    db.flush()
    documentation = MovementDocumentation(
        movement_id=movement.id,
        version=1,
        status="published",
        content={
            "notice": "Use controlled technique.",
            "difficulty": "beginner",
            "stressed_areas": ["Shoulders"],
            "prerequisites": [],
            "cautions": ["Stop for sharp pain."],
            "stop_conditions": ["Loss of control"],
        },
        published_at=datetime.now(UTC),
        edit_revision=1,
    )
    db.add(documentation)
    db.flush()

    response = client.get("/movements/public-admin-regression")

    assert response.status_code == 200
    assert response.json()["name"] == "Public Admin Regression"
    assert response.json()["documentation"]["status"] == "published"
