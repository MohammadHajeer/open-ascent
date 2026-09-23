from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.models.enums import MovementPrescriptionType
from app.models.movement import Movement
from app.schemas.movement import MovementCreate, MovementUpdate
from app.services.movement import MovementService
from scripts.seed_movements import MOVEMENTS


def test_seeded_movement_prescriptions_are_explicit() -> None:
    by_slug = {item["slug"]: item["prescription_type"] for item in MOVEMENTS}
    assert set(by_slug) == {
        "pull-up", "chin-up", "close-grip-pull-up", "wide-grip-pull-up",
        "high-pull-up", "muscle-up", "dips", "push-up", "front-lever",
        "back-lever", "inverted-deadlift",
    }
    assert {slug for slug, kind in by_slug.items() if kind == "duration"} == {
        "front-lever", "back-lever"
    }
    assert set(by_slug.values()) == {"duration", "repetitions"}


def test_plan_target_must_match_authoritative_movement_type() -> None:
    pull_up = Movement(
        slug="pull-up", name="Pull-Up", family_key="vertical_pull",
        prescription_type=MovementPrescriptionType.REPETITIONS,
    )
    front_lever = Movement(
        slug="front-lever", name="Front Lever", family_key="lever",
        prescription_type=MovementPrescriptionType.DURATION,
    )
    unknown = Movement(
        slug="unclassified", name="Unclassified", family_key="other",
        prescription_type=None,
    )
    assert MovementService.is_plan_prescription_compatible(
        pull_up, reps=5, hold_seconds=None
    )
    assert not MovementService.is_plan_prescription_compatible(
        pull_up, reps=None, hold_seconds=20
    )
    assert MovementService.is_plan_prescription_compatible(
        front_lever, reps=None, hold_seconds=20
    )
    assert not MovementService.is_plan_prescription_compatible(
        front_lever, reps=5, hold_seconds=None
    )
    assert not MovementService.is_plan_prescription_compatible(
        unknown, reps=5, hold_seconds=None
    )
    assert not MovementService.is_plan_prescription_compatible(
        pull_up, reps=True, hold_seconds=None
    )
    assert not MovementService.is_plan_prescription_compatible(
        front_lever, reps=None, hold_seconds=float("inf")
    )


def test_admin_create_requires_valid_prescription_type() -> None:
    payload = {
        "slug": "new-movement",
        "name": "New Movement",
        "family_key": "test",
    }
    with pytest.raises(ValidationError):
        MovementCreate.model_validate(payload)
    with pytest.raises(ValidationError):
        MovementCreate.model_validate(payload | {"prescription_type": "unknown"})
    assert (
        MovementCreate.model_validate(
            payload | {"prescription_type": "duration"}
        ).prescription_type
        is MovementPrescriptionType.DURATION
    )
    with pytest.raises(ValidationError):
        MovementUpdate.model_validate({"prescription_type": None})
    assert MovementUpdate.model_validate({}).model_dump(exclude_unset=True) == {}
