"""DOC-02 seed safety and repeatability checks without external services."""

import uuid
from types import SimpleNamespace

import pytest

from scripts.seed_demo import (
    ADMIN_NAME,
    ATHLETE_NAME,
    MARKER,
    required_env,
    save_valid_plan,
    stable_id,
)


def test_demo_ids_are_stable_and_separate() -> None:
    assert stable_id("athlete:workout:2") == stable_id("athlete:workout:2")
    assert stable_id("athlete:workout:2") != stable_id("athlete:workout:5")
    assert MARKER == "open-ascent-doc-02"
    assert (ADMIN_NAME, ATHLETE_NAME) == ("Mohammad Zeidan", "Yazan Al Rifaee")


def test_missing_credentials_fail_before_service_access(monkeypatch) -> None:
    monkeypatch.delenv("DEMO_ADMIN_PASSWORD", raising=False)
    monkeypatch.delenv("DEMO_ATHLETE_PASSWORD", raising=False)
    monkeypatch.setenv("APP_ENV", "development")
    with pytest.raises(SystemExit, match="DEMO_ADMIN_PASSWORD, DEMO_ATHLETE_PASSWORD"):
        required_env(("DEMO_ADMIN_PASSWORD", "DEMO_ATHLETE_PASSWORD"))


def test_production_is_refused(monkeypatch) -> None:
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("DEMO_ADMIN_PASSWORD", "test-only")
    with pytest.raises(SystemExit, match="disabled in production"):
        required_env(("DEMO_ADMIN_PASSWORD",))


def test_plan_is_skipped_when_readiness_has_no_evidence(monkeypatch) -> None:
    from app.services.readiness_evidence import ReadinessEvidenceBuilder

    monkeypatch.setattr(ReadinessEvidenceBuilder, "build", lambda *args, **kwargs: [])
    movements = {
        slug: SimpleNamespace(id=uuid.uuid4(), slug=slug)
        for slug in ("pull-up", "push-up", "dips")
    }
    profile = SimpleNamespace(id=uuid.uuid4(), athlete_state={})
    assert save_valid_plan(object(), profile, movements) is False
