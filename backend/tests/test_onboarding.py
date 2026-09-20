from __future__ import annotations

import uuid
from collections.abc import Iterator
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from app.api.dependencies.auth import get_current_user_id
from app.core.safety import CURRENT_SAFETY_ACK_VERSION
from app.db.database import get_db
from app.main import app
from app.models.movement import Movement
from app.models.profile import Profile


class Rows(list):
    def all(self):
        return self


class FakeDb:
    def __init__(self, user_id: uuid.UUID):
        self.user_id = user_id
        self.profile: Profile | None = None
        self.movements: list[Movement] = []
        self.commits = 0
        self.inserts = 0

    def scalar(self, _statement):
        return self.profile

    def scalars(self, _statement):
        return Rows(self.movements)

    def execute(self, _statement):
        self.inserts += 1
        if self.profile is None:
            self.profile = Profile(
                id=self.user_id,
                display_name="Pending",
                app_role="athlete",
                onboarding_completed_at=None,
                coaching_context={},
                initial_assessment={},
                athlete_state={},
            )

    def commit(self):
        self.commits += 1


def payload() -> dict:
    return {
        "display_name": "  Ada Athlete  ",
        "coaching_context": {
            "primary_goal": "strength",
            "equipment": ["pull_up_bar"],
            "availability": {"days_per_week": 3, "minutes_per_session": 45},
            "avoid_movement_ids": [],
        },
        "assessment": {
            "training_experience": "some",
            "max_clean_reps": {"pull_up": 0, "push_up": 12, "dips": None},
            "dimension_stage": {
                "pulling": "unknown",
                "pushing": "building",
                "core": "unknown",
                "balance": "unknown",
                "statics": "new",
            },
            "skill_progression": None,
        },
        "safety": {"version": CURRENT_SAFETY_ACK_VERSION, "acknowledged": True},
    }


@pytest.fixture
def fake_db() -> FakeDb:
    return FakeDb(uuid.uuid4())


@pytest.fixture
def client(fake_db: FakeDb) -> Iterator[TestClient]:
    app.dependency_overrides[get_db] = lambda: fake_db
    try:
        with TestClient(app) as test_client:
            yield test_client
    finally:
        app.dependency_overrides.pop(get_db, None)
        app.dependency_overrides.pop(get_current_user_id, None)


@pytest.fixture
def authenticated_client(client: TestClient, fake_db: FakeDb) -> TestClient:
    app.dependency_overrides[get_current_user_id] = lambda: fake_db.user_id
    return client


def test_onboarding_requires_authentication(client: TestClient) -> None:
    assert client.get("/profiles/onboarding/config").status_code == 401
    assert client.post("/profiles/onboarding", json=payload()).status_code == 401


def test_invalid_access_token_is_rejected(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    from app.api.dependencies.auth import supabase

    def reject(_token: str):
        raise ValueError("invalid token")

    monkeypatch.setattr(supabase.auth, "get_user", reject)
    response = client.post(
        "/profiles/onboarding",
        json=payload(),
        headers={"Authorization": "Bearer invalid-token"},
    )
    assert response.status_code == 401


def test_verified_token_identity_is_used_without_profile_dependency(
    client: TestClient, fake_db: FakeDb, monkeypatch: pytest.MonkeyPatch
) -> None:
    from app.api.dependencies.auth import supabase

    monkeypatch.setattr(
        supabase.auth,
        "get_user",
        lambda token: SimpleNamespace(user=SimpleNamespace(id=str(fake_db.user_id))),
    )
    response = client.post(
        "/profiles/onboarding",
        json=payload(),
        headers={"Authorization": "Bearer verified-token"},
    )
    assert response.status_code == 200, response.text
    assert fake_db.profile.id == fake_db.user_id


def test_creates_complete_profile_in_one_commit(
    authenticated_client: TestClient, fake_db: FakeDb
) -> None:
    response = authenticated_client.post("/profiles/onboarding", json=payload())
    assert response.status_code == 200, response.text
    profile = fake_db.profile
    assert profile is not None
    assert fake_db.inserts == 1
    assert fake_db.commits == 1
    assert profile.display_name == "Ada Athlete"
    assert profile.app_role == "athlete"
    assert profile.coaching_context == {"schema_version": 1, **payload()["coaching_context"]}
    assert profile.initial_assessment["answers"]["max_clean_reps"]["pull_up"] == 0
    assert profile.initial_assessment["answers"]["max_clean_reps"]["dips"] is None
    assert profile.initial_assessment["baseline"]["dimension_levels"]["pulling"] == "unknown"
    assert profile.athlete_state["dimensions"]["pulling"]["level"] == "unknown"
    assert profile.athlete_state["dimensions"]["pulling"]["source"] == "self_reported"
    assert profile.safety_ack_version == CURRENT_SAFETY_ACK_VERSION
    assert profile.safety_acknowledged_at is not None
    assert profile.onboarding_completed_at is not None


def test_existing_profile_is_updated_without_changing_role(
    authenticated_client: TestClient, fake_db: FakeDb
) -> None:
    fake_db.profile = Profile(
        id=fake_db.user_id,
        display_name="Old name",
        app_role="athlete",
        onboarding_completed_at=None,
        coaching_context={},
        initial_assessment={},
        athlete_state={"legacy": "unrelated"},
    )
    response = authenticated_client.post("/profiles/onboarding", json=payload())
    assert response.status_code == 200, response.text
    assert fake_db.inserts == 0
    assert fake_db.commits == 1
    assert fake_db.profile.display_name == "Ada Athlete"
    assert fake_db.profile.app_role == "athlete"
    assert fake_db.profile.athlete_state["schema_version"] == 1


def test_original_assessment_is_immutable_and_retry_is_idempotent(
    authenticated_client: TestClient, fake_db: FakeDb
) -> None:
    first = authenticated_client.post("/profiles/onboarding", json=payload())
    assert first.status_code == 200
    snapshot = fake_db.profile.initial_assessment.copy()
    retry = authenticated_client.post("/profiles/onboarding", json=payload())
    assert retry.status_code == 200
    assert retry.json()["onboarding_completed_at"] == first.json()["onboarding_completed_at"]
    changed = payload()
    changed["assessment"]["max_clean_reps"]["pull_up"] = 10
    assert authenticated_client.post("/profiles/onboarding", json=changed).status_code == 409
    assert fake_db.profile.initial_assessment == snapshot
    assert fake_db.commits == 1


def test_invalid_input_and_client_owned_state_are_rejected(
    authenticated_client: TestClient, fake_db: FakeDb
) -> None:
    invalid = payload()
    invalid["display_name"] = " "
    assert authenticated_client.post("/profiles/onboarding", json=invalid).status_code == 422
    forged = payload()
    forged["user_id"] = str(uuid.uuid4())
    forged["athlete_state"] = {"overall_level": "established"}
    assert authenticated_client.post("/profiles/onboarding", json=forged).status_code == 422
    mixed_equipment = payload()
    mixed_equipment["coaching_context"]["equipment"] = ["none", "rings"]
    assert authenticated_client.post("/profiles/onboarding", json=mixed_equipment).status_code == 422
    assert fake_db.profile is None
    assert fake_db.commits == 0


def test_config_exposes_current_global_guidance_and_catalog_choices(
    authenticated_client: TestClient, fake_db: FakeDb
) -> None:
    skill = Movement(id=uuid.uuid4(), slug="front-lever", name="Front lever", family_key="lever")
    fake_db.movements.append(skill)
    response = authenticated_client.get("/profiles/onboarding/config")
    assert response.status_code == 200
    body = response.json()
    assert body["safety_version"] == CURRENT_SAFETY_ACK_VERSION
    assert len(body["safety_guidance"]) == 3
    assert body["skill_movements"] == [{"id": str(skill.id), "name": "Front lever"}]


def test_valid_skill_progression_is_stored_as_self_report(
    authenticated_client: TestClient, fake_db: FakeDb
) -> None:
    skill = Movement(id=uuid.uuid4(), slug="front-lever", name="Front lever", family_key="lever")
    fake_db.movements.append(skill)
    with_skill = payload()
    with_skill["assessment"]["skill_progression"] = {
        "movement_id": str(skill.id), "stage": "practicing"
    }
    response = authenticated_client.post("/profiles/onboarding", json=with_skill)
    assert response.status_code == 200, response.text
    assert fake_db.profile.initial_assessment["answers"]["skill_progression"] == {
        "movement_id": str(skill.id), "stage": "practicing"
    }


def test_catalog_and_safety_validation_precede_profile_creation(
    authenticated_client: TestClient, fake_db: FakeDb
) -> None:
    unknown = payload()
    unknown["assessment"]["skill_progression"] = {
        "movement_id": str(uuid.uuid4()), "stage": "practicing"
    }
    assert authenticated_client.post("/profiles/onboarding", json=unknown).status_code == 422
    movement = Movement(id=uuid.uuid4(), slug="push-up", name="Push-up", family_key="horizontal_push")
    fake_db.movements.append(movement)
    wrong_skill = payload()
    wrong_skill["assessment"]["skill_progression"] = {
        "movement_id": str(movement.id), "stage": "practicing"
    }
    assert authenticated_client.post("/profiles/onboarding", json=wrong_skill).status_code == 422
    outdated = payload()
    outdated["safety"]["version"] = "old-version"
    assert authenticated_client.post("/profiles/onboarding", json=outdated).status_code == 409
    assert fake_db.profile is None
    assert fake_db.commits == 0
