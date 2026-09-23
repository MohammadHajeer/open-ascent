from __future__ import annotations

import uuid
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.dialects import postgresql

from app.api.admin_management import _safe_error
from app.api.dependencies.auth import get_current_profile, get_current_user_id
from app.db.database import get_db
from app.main import app
from app.services.entitlements import _effective_pro_users_query


@pytest.mark.parametrize(
    "method,path",
    [
        ("get", "/admin/management/users"),
        ("get", f"/admin/management/users/{uuid.uuid4()}"),
        ("get", "/admin/management/analyses"),
        ("get", f"/admin/management/analyses/{uuid.uuid4()}"),
        ("get", "/admin/management/usage"),
        ("get", "/admin/management/plans"),
        ("get", f"/admin/management/plans/{uuid.uuid4()}"),
    ],
)
def test_management_requires_database_admin(method: str, path: str) -> None:
    app.dependency_overrides[get_db] = lambda: SimpleNamespace()
    app.dependency_overrides[get_current_user_id] = lambda: uuid.uuid4()
    app.dependency_overrides[get_current_profile] = lambda: SimpleNamespace(
        app_role="athlete"
    )
    try:
        with TestClient(app) as client:
            assert getattr(client, method)(path).status_code == 403
    finally:
        app.dependency_overrides.clear()


@pytest.mark.parametrize(
    "path",
    [
        "/admin/management/users?page_size=101",
        "/admin/management/analyses?page=0",
        "/admin/management/usage?page=1001",
        "/admin/management/plans?page_size=0",
        "/admin/management/users?q=" + "x" * 81,
    ],
)
def test_management_list_bounds(path: str) -> None:
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


def test_failure_summary_is_allowlisted() -> None:
    assert _safe_error("password=secret stacktrace") == "Analysis processing failed."
    assert (
        _safe_error("attempts_exhausted") == "The analysis exhausted its attempt limit."
    )


def test_effective_tier_batch_query_uses_shared_provider_predicate() -> None:
    from datetime import UTC, datetime

    query = _effective_pro_users_query([uuid.uuid4()], datetime.now(UTC))
    sql = str(query.compile(dialect=postgresql.dialect()))
    assert "user_subscriptions.provider_status" in sql
    assert "user_subscriptions.last_verified_at" in sql
    assert "user_subscriptions.user_id IN" in sql
