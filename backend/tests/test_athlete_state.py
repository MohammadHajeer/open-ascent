"""COACH-07 capability comparability and owner-scoped recalibration."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import create_engine, event
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.models.analysis import Analysis
from app.models.movement import Movement
from app.models.profile import Profile
from app.models.training import WorkoutSession, WorkoutSet
from app.schemas.workout import WorkoutSetCreate, WorkoutSetUpdate
from app.services.athlete_state import (
    apply_measured_capability,
    recalibrate_from_analysis,
)
from app.services.onboarding import derive_athlete_state
from app.services.workout import WorkoutValidationError, add_set, update_set


@compiles(JSONB, "sqlite")
def _jsonb_sqlite(_type, _compiler, **_kwargs):
    return "JSON"


@pytest.fixture
def db():
    engine = create_engine("sqlite://", poolclass=StaticPool)

    @event.listens_for(engine, "connect")
    def register_functions(connection, _record):
        connection.create_function("gen_random_uuid", 0, lambda: uuid.uuid4().hex)
        connection.create_function("now", 0, lambda: datetime.now(UTC).isoformat())

    tables = (
        Profile.__table__,
        Movement.__table__,
        Analysis.__table__,
        WorkoutSession.__table__,
        WorkoutSet.__table__,
    )
    defaults = [
        (column, column.server_default)
        for table in tables
        for column in table.columns
        if isinstance(column.type, JSONB)
    ]
    partial_indexes = [
        (table, index)
        for table in tables
        for index in list(table.indexes)
        if index.dialect_options["postgresql"].get("where") is not None
    ]
    for column, _ in defaults:
        column.server_default = None
    for table, index in partial_indexes:
        table.indexes.remove(index)
    try:
        for table in tables:
            table.create(engine)
    finally:
        for column, default in defaults:
            column.server_default = default
        for table, index in partial_indexes:
            table.indexes.add(index)
    with Session(engine, expire_on_commit=False) as session:
        yield session
    engine.dispose()


def _assessment(at: datetime, reps: int = 5) -> dict:
    return {
        "submitted_at": at.isoformat(),
        "answers": {"max_clean_reps": {"pull_up": reps, "push_up": None, "dips": None}},
        "baseline": {
            "overall_level": "developing",
            "dimension_levels": {
                key: "developing"
                for key in ("pulling", "pushing", "core", "balance", "statics")
            },
        },
    }


def _profile(db: Session, movement: Movement, *, reps: int = 5) -> Profile:
    at = datetime.now(UTC) - timedelta(days=2)
    assessment = _assessment(at, reps)
    profile = Profile(
        id=uuid.uuid4(),
        display_name="Athlete",
        app_role="athlete",
        onboarding_completed_at=at,
        coaching_context={},
        initial_assessment=assessment,
        athlete_state=derive_athlete_state(
            assessment, {movement.slug: str(movement.id)}
        ),
    )
    db.add(profile)
    db.flush()
    return profile


def _movement(db: Session, slug="pull-up", kind="repetitions") -> Movement:
    item = Movement(
        id=uuid.uuid4(),
        slug=slug,
        name=slug,
        family_key="test",
        prescription_type=kind,
    )
    db.add(item)
    db.flush()
    return item


def _analysis(
    db: Session,
    owner: Profile,
    movement: Movement,
    *,
    reps=8,
    intent="max_test",
    target_match=True,
    at=None,
    linked=True,
    performer="self",
    set_intent="max_test",
) -> Analysis:
    at = at or datetime.now(UTC)
    result = {
        "outcome": "completed" if reps else "zero_valid_reps",
        "valid_rep_count": reps,
        "reps": [
            {"outcome": "valid", "target_match": target_match} for _ in range(reps)
        ]
        or [{"outcome": "partial", "target_match": target_match}],
    }
    analysis = Analysis(
        id=uuid.uuid4(),
        user_id=owner.id,
        movement_id=movement.id,
        family_key=movement.family_key,
        owner_kind="authenticated",
        status="completed",
        stage="completed",
        execution_intent=intent,
        safety_documentation_id=uuid.uuid4(),
        safety_ack_version="test",
        safety_acknowledged_at=at,
        reservation_operation_key=str(uuid.uuid4()),
        request_fingerprint="test",
        reservation_expires_at=at + timedelta(days=1),
        completed_at=at,
        valid_rep_count=reps,
        terminal_outcome=result["outcome"],
        result=result,
        progress_snapshot={},
        ai_feedback_status="skipped",
    )
    db.add(analysis)
    db.flush()
    if linked:
        workout = WorkoutSession(
            id=uuid.uuid4(),
            user_id=owner.id,
            source="uploaded_analysis",
            started_at=at,
            completed_at=at,
        )
        db.add(workout)
        db.flush()
        db.add(
            WorkoutSet(
                id=uuid.uuid4(),
                session_id=workout.id,
                movement_id=movement.id,
                analysis_id=analysis.id,
                position=0,
                source="uploaded_analysis",
                performer=performer,
                intent=set_intent,
                reps=max(1, reps),
            )
        )
        db.flush()
    return analysis


@pytest.mark.parametrize("measured", [8, 9])
def test_target_matched_max_test_replaces_self_report_even_when_lower(db, measured):
    pull_up = _movement(db)
    athlete = _profile(db, pull_up, reps=15 if measured == 9 else 5)
    analysis = _analysis(db, athlete, pull_up, reps=measured)
    original_assessment = athlete.initial_assessment.copy()

    assert recalibrate_from_analysis(db, user_id=athlete.id, analysis_id=analysis.id)
    capability = athlete.athlete_state["capabilities"][str(pull_up.id)]
    assert capability["value"] == measured
    assert capability["source"] == "uploaded_analysis"
    assert capability["confidence"] == "measured"
    assert capability["evidence_refs"][0] == f"analysis:{analysis.id}"
    assert capability["evidence_refs"][1].startswith("workout_set:")
    assert capability["history"][0]["value"] == (15 if measured == 9 else 5)
    assert capability["history"][0]["source"] == "self_reported"
    assert athlete.initial_assessment == original_assessment
    snapshot = athlete.athlete_state.copy()
    assert not recalibrate_from_analysis(
        db, user_id=athlete.id, analysis_id=analysis.id
    )
    assert athlete.athlete_state == snapshot


def test_other_movement_intent_target_and_owner_do_not_recalibrate(db):
    pull_up = _movement(db)
    dip = _movement(db, "dips")
    athlete = _profile(db, pull_up)
    other = _profile(db, pull_up)
    before = athlete.athlete_state.copy()
    for movement, intent, matched in (
        (dip, "max_test", True),
        (pull_up, "normal_training", True),
        (pull_up, "max_test", False),
    ):
        analysis = _analysis(db, athlete, movement, intent=intent, target_match=matched)
        assert not recalibrate_from_analysis(
            db, user_id=athlete.id, analysis_id=analysis.id
        )
        assert athlete.athlete_state == before
    owned_by_other = _analysis(db, other, pull_up)
    assert not recalibrate_from_analysis(
        db, user_id=athlete.id, analysis_id=owned_by_other.id
    )
    assert athlete.athlete_state == before


def test_standalone_or_nonself_analysis_does_not_recalibrate(db):
    pull_up = _movement(db)
    athlete = _profile(db, pull_up)
    for kwargs in (
        {"linked": False},
        {"performer": "other"},
        {"set_intent": "training_set"},
    ):
        analysis = _analysis(db, athlete, pull_up, **kwargs)
        assert not recalibrate_from_analysis(
            db, user_id=athlete.id, analysis_id=analysis.id
        )
    assert athlete.athlete_state["capabilities"][str(pull_up.id)]["value"] == 5


def test_verified_zero_rep_max_can_correct_an_optimistic_self_report(db):
    pull_up = _movement(db)
    athlete = _profile(db, pull_up, reps=10)
    analysis = _analysis(db, athlete, pull_up, reps=0)
    assert recalibrate_from_analysis(db, user_id=athlete.id, analysis_id=analysis.id)
    assert athlete.athlete_state["capabilities"][str(pull_up.id)]["value"] == 0


def test_mixed_target_reps_do_not_establish_a_maximum(db):
    pull_up = _movement(db)
    athlete = _profile(db, pull_up)
    analysis = _analysis(db, athlete, pull_up, reps=2)
    analysis.result = {
        **analysis.result,
        "reps": [
            {"outcome": "valid", "target_match": True},
            {"outcome": "valid", "target_match": False},
        ],
    }
    db.flush()
    assert not recalibrate_from_analysis(
        db, user_id=athlete.id, analysis_id=analysis.id
    )


def test_older_evidence_cannot_replace_newer_measured_capability(db):
    pull_up = _movement(db)
    athlete = _profile(db, pull_up)
    newer = _analysis(db, athlete, pull_up, reps=9, at=datetime.now(UTC))
    assert recalibrate_from_analysis(db, user_id=athlete.id, analysis_id=newer.id)
    older = _analysis(
        db, athlete, pull_up, reps=12, at=datetime.now(UTC) - timedelta(days=1)
    )
    assert not recalibrate_from_analysis(db, user_id=athlete.id, analysis_id=older.id)
    assert athlete.athlete_state["capabilities"][str(pull_up.id)]["value"] == 9


def test_legacy_state_is_seeded_only_when_measured_evidence_qualifies(db):
    pull_up = _movement(db)
    athlete = _profile(db, pull_up)
    athlete.athlete_state = {
        key: value
        for key, value in athlete.athlete_state.items()
        if key != "capabilities"
    }
    db.flush()
    analysis = _analysis(db, athlete, pull_up)
    assert recalibrate_from_analysis(db, user_id=athlete.id, analysis_id=analysis.id)
    assert athlete.athlete_state["capabilities"][str(pull_up.id)]["value"] == 8


def test_workout_link_triggers_recalibration_from_analyzer_not_editable_count(db):
    pull_up = _movement(db)
    athlete = _profile(db, pull_up)
    analysis = _analysis(db, athlete, pull_up, linked=False)
    at = datetime.now(UTC)
    workout = WorkoutSession(
        id=uuid.uuid4(),
        user_id=athlete.id,
        source="uploaded_analysis",
        started_at=at,
        completed_at=at,
    )
    db.add(workout)
    db.flush()
    linked = add_set(
        db,
        athlete.id,
        workout.id,
        WorkoutSetCreate(
            movement_id=pull_up.id,
            position=0,
            source="uploaded_analysis",
            performer="self",
            intent="max_test",
            reps=99,
            analysis_id=analysis.id,
        ),
    )
    assert athlete.athlete_state["capabilities"][str(pull_up.id)]["value"] == 8
    with pytest.raises(WorkoutValidationError, match="retain its attribution"):
        update_set(
            db, athlete.id, workout.id, linked.id, WorkoutSetUpdate(performer="other")
        )


def test_manual_and_live_coach_max_sets_do_not_recalibrate(db):
    pull_up = _movement(db)
    athlete = _profile(db, pull_up)
    at = datetime.now(UTC)
    workout = WorkoutSession(
        id=uuid.uuid4(),
        user_id=athlete.id,
        source="manual",
        started_at=at,
        completed_at=at,
    )
    db.add(workout)
    db.flush()
    for position, source in enumerate(("manual", "self_reported", "live_coach")):
        add_set(
            db,
            athlete.id,
            workout.id,
            WorkoutSetCreate(
                movement_id=pull_up.id,
                position=position,
                source=source,
                performer="self",
                intent="max_test",
                reps=20,
            ),
        )
    assert athlete.athlete_state["capabilities"][str(pull_up.id)]["value"] == 5


def test_metric_context_and_source_must_match_for_holds():
    movement_id = uuid.uuid4()
    at = datetime.now(UTC) - timedelta(days=1)
    state = {
        "capabilities": {
            str(movement_id): {
                "movement_id": str(movement_id),
                "movement_slug": "front-lever",
                "metric": "hold_seconds",
                "intent": "max_test",
                "value": 12,
                "source": "self_reported",
                "confidence": "provisional",
                "observed_at": at.isoformat(),
                "evidence_refs": ["initial:hold"],
            }
        }
    }
    options = {
        "movement_id": movement_id,
        "metric": "hold_seconds",
        "intent": "max_test",
        "value": 10.5,
        "observed_at": at + timedelta(hours=1),
        "evidence_ref": "analysis:hold",
        "source": "uploaded_analysis",
    }
    for overrides in (
        {"movement_id": uuid.uuid4()},
        {"metric": "reps", "value": 10},
        {"intent": "training_set"},
        {"source": "manual"},
        {"source": "self_reported"},
        {"source": "live_coach"},
        {"observed_at": at - timedelta(hours=1)},
    ):
        assert apply_measured_capability(state, **(options | overrides)) is None
    updated = apply_measured_capability(state, **options)
    assert updated["capabilities"][str(movement_id)]["value"] == 10.5
    assert state["capabilities"][str(movement_id)]["value"] == 12
    assert apply_measured_capability(updated, **options) is None
