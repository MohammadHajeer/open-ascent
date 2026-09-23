from __future__ import annotations

import uuid
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from app.api.dependencies.auth import get_current_profile, get_current_user_id
from app.db.database import get_db
from app.main import app
from app.schemas.movement_documentation import MovementDocumentationUpdate
from app.services.movement_documentation import (
    DocumentationRevisionConflictError,
    MovementDocumentationService,
)


def test_stale_edit_revision_rejected_before_content_change() -> None:
    row = SimpleNamespace(
        id=uuid.uuid4(), status="draft", edit_revision=2, content={"notice": "current"}
    )
    db = SimpleNamespace(scalar=lambda _statement: row)
    with pytest.raises(DocumentationRevisionConflictError):
        MovementDocumentationService.update_draft(
            db,
            row.id,
            MovementDocumentationUpdate(edit_revision=1, content={"notice": "stale"}),
        )
    assert row.content == {"notice": "current"}


def test_stale_publish_revision_rejected_before_validation() -> None:
    row = SimpleNamespace(
        id=uuid.uuid4(), status="draft", edit_revision=3, content={"notice": "current"}
    )
    db = SimpleNamespace(scalar=lambda _statement: row)
    with pytest.raises(DocumentationRevisionConflictError):
        MovementDocumentationService.publish_draft(
            db, row.id, uuid.uuid4(), expected_revision=2
        )
    assert row.status == "draft"


@pytest.mark.parametrize(
    "path",
    [
        "/movements/documentation/admin",
        f"/movements/documentation/admin/{uuid.uuid4()}",
    ],
)
def test_new_documentation_reads_require_admin(path: str) -> None:
    app.dependency_overrides[get_db] = lambda: SimpleNamespace()
    app.dependency_overrides[get_current_user_id] = lambda: uuid.uuid4()
    app.dependency_overrides[get_current_profile] = lambda: SimpleNamespace(
        app_role="athlete"
    )
    try:
        with TestClient(app) as client:
            assert client.get(path).status_code == 403
    finally:
        app.dependency_overrides.clear()


@pytest.mark.parametrize(
    "path",
    [
        "/movements/documentation/admin?page_size=101",
        "/movements/documentation/admin?page=0",
        "/movements/documentation/admin?status=unknown",
        "/movements/documentation/admin?q=" + "x" * 81,
    ],
)
def test_documentation_list_bounds(path: str) -> None:
    app.dependency_overrides[get_db] = lambda: SimpleNamespace()
    app.dependency_overrides[get_current_user_id] = lambda: uuid.uuid4()
    app.dependency_overrides[get_current_profile] = lambda: SimpleNamespace(
        app_role="admin"
    )
    try:
        with TestClient(app) as client:
            assert client.get(path).status_code == 422
    finally:
        app.dependency_overrides.clear()


def test_update_endpoint_returns_conflict_for_stale_revision() -> None:
    row = SimpleNamespace(
        id=uuid.uuid4(), status="draft", edit_revision=2, content={"notice": "current"}
    )
    app.dependency_overrides[get_db] = lambda: SimpleNamespace(
        scalar=lambda _statement: row
    )
    app.dependency_overrides[get_current_user_id] = lambda: uuid.uuid4()
    app.dependency_overrides[get_current_profile] = lambda: SimpleNamespace(
        app_role="admin", id=uuid.uuid4()
    )
    try:
        with TestClient(app) as client:
            response = client.patch(
                f"/movements/documentation/{row.id}",
                json={
                    "edit_revision": 1,
                    "content": {"notice": "stale"},
                },
            )
        assert response.status_code == 409
        assert "Reload" in response.json()["error"]["message"]
    finally:
        app.dependency_overrides.clear()


def test_documentation_list_reads_summary_without_content_validation() -> None:
    from datetime import UTC, datetime

    from app.api.movement_documentation import list_admin_documentation

    now = datetime.now(UTC)
    row = (
        uuid.uuid4(),
        uuid.uuid4(),
        2,
        "draft",
        3,
        now,
        None,
        uuid.uuid4(),
        "Pull-up",
        "pull-up",
        "vertical_pull",
    )
    db = SimpleNamespace(scalar=lambda _statement: 1, execute=lambda _statement: [row])
    result = list_admin_documentation(
        db,
        SimpleNamespace(app_role="admin"),
        page=1,
        page_size=20,
        status_filter=None,
        movement_id=None,
        q=None,
    )
    assert result["total"] == 1
    assert result["items"][0]["movement"]["name"] == "Pull-up"
    assert "content" not in result["items"][0]
