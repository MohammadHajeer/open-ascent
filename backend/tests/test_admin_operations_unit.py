from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from app.api.admin_operations import _health, _safe_failure, overview
from app.api.dependencies.auth import get_current_profile, get_current_user_id
from app.db.database import get_db
from app.main import app
from app.services import analysis_events
from app.services.analysis_jobs import (
    MAX_ANALYSIS_ATTEMPTS,
    AnalysisRetryUnavailableError,
    claim_next_analysis,
    retry_failed_analysis,
)


def test_worker_health_uses_heartbeat_not_job_assignment() -> None:
    now = datetime.now(UTC)
    worker = SimpleNamespace(
        state="busy",
        current_job_id=uuid.uuid4(),
        last_seen_at=now - timedelta(seconds=31),
    )
    assert _health(worker, now) == "stale"
    worker.last_seen_at = now - timedelta(seconds=91)
    assert _health(worker, now) == "failed"
    worker.last_seen_at = now
    assert _health(worker, now) == "healthy"
    worker.state = "stopped"
    assert _health(worker, now) == "stopped"


def test_failure_copy_is_allowlisted() -> None:
    assert (
        _safe_failure("analysis", "private traceback and token")
        == "Analysis processing failed."
    )
    assert (
        _safe_failure("explanation", "private traceback")
        == "Explanation processing failed or timed out."
    )


def test_overview_fills_missing_utc_throughput_days() -> None:
    now = datetime(2026, 9, 23, 12, tzinfo=UTC)

    class Db:
        def __init__(self):
            self.values = iter([now, 0, 0, 4, 1])
            self.rows = iter(
                [
                    [("completed", now.date(), 4), ("failed", now.date(), 1)],
                    [("athlete", 2)],
                    [("completed", 4)],
                    [("completed", 4)],
                ]
            )

        def scalar(self, _statement):
            return next(self.values)

        def execute(self, _statement):
            class Rows(list):
                def all(self):
                    return self

            return Rows(next(self.rows))

        def scalars(self, _statement):
            return SimpleNamespace(all=list)

    result = overview(Db(), SimpleNamespace(app_role="admin"))
    assert len(result["throughput_daily"]) == 7
    assert result["throughput_daily"][0] == {
        "date": "2026-09-17",
        "completed": 0,
        "failed": 0,
    }
    assert result["throughput_daily"][-1] == {
        "date": "2026-09-23",
        "completed": 4,
        "failed": 1,
    }


def test_exhausted_analysis_becomes_terminal(monkeypatch: pytest.MonkeyPatch) -> None:
    now = datetime.now(UTC)
    analysis = SimpleNamespace(
        id=uuid.uuid4(),
        status="running",
        stage="processing_started",
        attempts=MAX_ANALYSIS_ATTEMPTS,
        owner_kind="guest",
        feature_usage_id=None,
        claim_token="old",
        lease_expires_at=now - timedelta(seconds=1),
        error_code=None,
        failed_at=None,
    )

    class Db:
        commits = 0

        def __init__(self):
            self.values = iter([analysis, now])

        def scalar(self, _statement):
            return next(self.values)

        def commit(self):
            self.commits += 1

    events = []
    monkeypatch.setattr(
        analysis_events,
        "record_analysis_event",
        lambda *args, **kwargs: events.append(kwargs),
    )
    db = Db()
    assert claim_next_analysis(db) is None
    assert analysis.status == "failed"
    assert analysis.error_code == "attempts_exhausted"
    assert analysis.claim_token is None
    assert db.commits == 1
    assert events[0]["attempt"] == MAX_ANALYSIS_ATTEMPTS


def test_retry_requires_remaining_budget_and_guest_media() -> None:
    now = datetime.now(UTC)
    analysis = SimpleNamespace(
        id=uuid.uuid4(),
        status="failed",
        owner_kind="guest",
        feature_usage_id=None,
        video_path="private/video",
        guest_cleaned_at=None,
        access_expires_at=now + timedelta(hours=1),
        attempts=MAX_ANALYSIS_ATTEMPTS,
        stage="failed",
        error_code="processing_error",
        failed_at=now,
        claim_token=None,
        lease_expires_at=None,
        progress_snapshot={},
    )

    class Db:
        def __init__(self):
            self.commits = 0
            self.rollbacks = 0
            self.values = iter([analysis, now])

        def scalar(self, _statement):
            return next(self.values)

        def rollback(self):
            self.rollbacks += 1

        def commit(self):
            self.commits += 1

    db = Db()
    with pytest.raises(AnalysisRetryUnavailableError):
        retry_failed_analysis(db, analysis.id)
    assert db.rollbacks == 1

    analysis.attempts = 1
    db = Db()
    retry_failed_analysis(db, analysis.id)
    assert analysis.status == "queued"
    assert analysis.error_code is None
    assert db.commits == 1


@pytest.mark.parametrize(
    "path",
    [
        "/admin/operations/overview",
        "/admin/operations/workers",
        "/admin/operations/jobs",
        "/admin/operations/failures",
        f"/admin/operations/jobs/analysis/{uuid.uuid4()}/retry",
        f"/admin/operations/jobs/explanation/{uuid.uuid4()}/retry",
    ],
)
def test_operational_routes_reject_athlete(path: str) -> None:
    app.dependency_overrides[get_db] = lambda: SimpleNamespace()
    app.dependency_overrides[get_current_user_id] = lambda: uuid.uuid4()
    app.dependency_overrides[get_current_profile] = lambda: SimpleNamespace(
        app_role="athlete"
    )
    try:
        with TestClient(app) as client:
            response = (
                client.post(path) if path.endswith("/retry") else client.get(path)
            )
        assert response.status_code == 403
    finally:
        app.dependency_overrides.clear()


@pytest.mark.parametrize(
    "path",
    [
        "/admin/operations/workers?page_size=101",
        "/admin/operations/jobs?page=0",
        "/admin/operations/failures?page=1001",
    ],
)
def test_list_limits_are_validated(path: str) -> None:
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
