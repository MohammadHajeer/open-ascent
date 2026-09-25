from __future__ import annotations

import uuid
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Column, Integer, String, create_engine, func, select
from sqlalchemy.dialects import postgresql
from sqlalchemy.orm import Session, declarative_base
from sqlalchemy.pool import StaticPool

from app.api.admin_management import _safe_error, management_summary
from app.api.dependencies.auth import get_current_profile, get_current_user_id
from app.db.database import get_db
from app.main import app
from app.services.entitlements import _effective_pro_users_query


@pytest.mark.parametrize(
    "method,path",
    [
        ("get", "/admin/management/users"),
        ("get", "/admin/management/summary"),
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


def test_management_summary_uses_aggregate_counts_and_current_usage() -> None:
    base = declarative_base()

    class RoleRow(base):
        __tablename__ = "role_rows"
        id = Column(Integer, primary_key=True)
        role = Column(String, nullable=False)

    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    base.metadata.create_all(engine)
    session = Session(engine)
    session.add_all(
        [RoleRow(role=role) for role, count in (("athlete", 8), ("admin", 2)) for _ in range(count)]
    )
    session.commit()

    class Db:
        def __init__(self):
            self.rows = iter(
                [
                    [
                        ("video_analysis", "consumed", 12),
                        ("video_analysis", "reserved", 3),
                    ],
                ]
            )
            self.values = iter([6, 3, 5, 2])
            self.first_execute = True

        def execute(self, _statement):
            if self.first_execute:
                self.first_execute = False
                result = session.execute(
                    select(RoleRow.role, func.count()).group_by(RoleRow.role)
                )
                assert type(result).__name__ == "ChunkedIteratorResult"
                return result
            return next(self.rows)

        def scalar(self, _statement):
            return next(self.values)

    result = management_summary(Db(), SimpleNamespace(app_role="admin"))
    assert result["users"] == {
        "total": 10,
        "athletes": 8,
        "admins": 2,
        "onboarded_athletes": 6,
    }
    assert result["tiers"] == {"pro_athletes": 3, "free_athletes": 5}
    assert result["usage"]["video_analysis"] == {"consumed": 12, "reserved": 3}
    assert result["plans"] == {"total": 5, "saved_30d": 2}

    app.dependency_overrides[get_db] = Db
    app.dependency_overrides[get_current_user_id] = lambda: uuid.uuid4()
    app.dependency_overrides[get_current_profile] = lambda: SimpleNamespace(
        app_role="admin"
    )
    try:
        with TestClient(app) as client:
            response = client.get("/admin/management/summary")
        assert response.status_code == 200
        assert response.json()["users"] == result["users"]
        assert response.json()["tiers"] == result["tiers"]
    finally:
        app.dependency_overrides.clear()
        session.close()
        engine.dispose()


def test_unfiltered_pro_tier_aggregate_keeps_provider_predicate() -> None:
    from datetime import UTC, datetime

    sql = str(
        _effective_pro_users_query(None, datetime.now(UTC)).compile(
            dialect=postgresql.dialect()
        )
    )
    assert "user_subscriptions.provider_status" in sql
    assert "user_subscriptions.last_verified_at" in sql
    assert "user_subscriptions.user_id IN" not in sql
