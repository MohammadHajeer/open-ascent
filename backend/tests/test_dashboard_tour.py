from __future__ import annotations

import uuid

from fastapi.testclient import TestClient

from app.api.dependencies.auth import get_current_user_id
from app.db.database import get_db
from app.main import app
from app.models.profile import Profile


class TourDb:
    def __init__(self):
        self.first = Profile(id=uuid.uuid4(), display_name="First", app_role="athlete", dashboard_tour_status="not_started")
        self.other = Profile(id=uuid.uuid4(), display_name="Other", app_role="athlete", dashboard_tour_status="not_started")
        self.current_id = self.first.id
        self.commits = 0

    def scalar(self, _statement):
        return self.first if self.current_id == self.first.id else self.other

    def commit(self):
        self.commits += 1


def test_dashboard_tour_decision_is_self_only_and_first_decision_wins():
    db = TourDb()
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user_id] = lambda: db.current_id
    try:
        with TestClient(app) as client:
            assert client.get("/profiles/me/dashboard-tour").json() == {"status": "not_started"}
            assert client.put("/profiles/me/dashboard-tour", json={"status": "dismissed", "user_id": str(db.other.id)}).status_code == 422
            response = client.put("/profiles/me/dashboard-tour", json={"status": "dismissed"})
            assert response.status_code == 200
            assert response.json() == {"status": "dismissed"}
            assert db.other.dashboard_tour_status == "not_started"
            assert db.commits == 1
            assert client.put("/profiles/me/dashboard-tour", json={"status": "completed"}).json() == {"status": "dismissed"}
            assert db.commits == 1
            assert client.put("/profiles/me/dashboard-tour", json={"status": "not_started"}).status_code == 422
            db.current_id = db.other.id
            assert client.get("/profiles/me/dashboard-tour").json() == {"status": "not_started"}
            assert client.put("/profiles/me/dashboard-tour", json={"status": "completed"}).json() == {"status": "completed"}
    finally:
        app.dependency_overrides.pop(get_db, None)
        app.dependency_overrides.pop(get_current_user_id, None)


def test_dashboard_tour_requires_auth_and_athlete_role():
    db = TourDb()
    app.dependency_overrides[get_db] = lambda: db
    try:
        with TestClient(app) as client:
            assert client.get("/profiles/me/dashboard-tour").status_code == 401
            assert client.put("/profiles/me/dashboard-tour", json={"status": "completed"}).status_code == 401
            app.dependency_overrides[get_current_user_id] = lambda: db.current_id
            db.first.app_role = "admin"
            assert client.get("/profiles/me/dashboard-tour").status_code == 403
            assert client.put("/profiles/me/dashboard-tour", json={"status": "completed"}).status_code == 403
            assert db.commits == 0
    finally:
        app.dependency_overrides.pop(get_db, None)
        app.dependency_overrides.pop(get_current_user_id, None)
