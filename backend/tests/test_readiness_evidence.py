"""Deterministic SAF-04 evidence construction; no model interpretation."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path

import pytest
from pydantic import ValidationError
from sqlalchemy import create_engine, event
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.models.analysis import Analysis
from app.models.movement import Movement
from app.models.movement_documentation import MovementDocumentation
from app.models.profile import Profile
from app.models.training import WorkoutSession, WorkoutSet
from app.schemas.movement_documentation import MovementDocumentationUpdate
from app.schemas.movement_safety import MovementSafetyContent
from app.schemas.readiness import ReadinessStatus
from app.services.movement_documentation import (
    InvalidSafetyContentError,
    MovementDocumentationService,
)
from app.services.readiness import ReadinessService
from app.services.readiness_evidence import ReadinessEvidenceBuilder
from scripts.seed_movements import CURATED_READINESS_RULES, MOVEMENTS, seed_movement


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
        MovementDocumentation.__table__,
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
    with sessionmaker(engine, expire_on_commit=False)() as session:
        yield session
    engine.dispose()


def athlete(db, *, assessment=None, avoided=None) -> Profile:
    profile = Profile(
        id=uuid.uuid4(),
        display_name="Athlete",
        app_role="athlete",
        coaching_context={"avoid_movement_ids": [str(item) for item in avoided or []]},
        initial_assessment=assessment or {},
        athlete_state={},
    )
    db.add(profile)
    db.flush()
    return profile


def movement(db, *, slug="pull-up", kind="repetitions") -> Movement:
    item = Movement(
        id=uuid.uuid4(), slug=slug, name=slug, family_key="test",
        prescription_type=kind,
    )
    db.add(item)
    db.flush()
    return item


def rule(source_movement: Movement, *, sources=None, metric="reps", value=5, age=30):
    return {
        "code": "minimum_source_performance",
        "type": "movement_performance",
        "prerequisite_index": 0,
        "movement_id": str(source_movement.id),
        "metric": metric,
        "operator": ">=",
        "value": value,
        "max_age_days": age,
        "accepted_sources": sources or ["uploaded_analysis"],
    }


def documentation(db, target: Movement, *, readiness_rule=None, prerequisites=None):
    content = {
        "notice": "Move with control.",
        "difficulty": "intermediate",
        "stressed_areas": ["shoulders"],
        "prerequisites": prerequisites if prerequisites is not None else ["Demonstrate required performance"],
        "cautions": ["Stop for pain"],
        "stop_conditions": ["Loss of control"],
    }
    if readiness_rule is not None:
        content["readiness_rules"] = [readiness_rule]
    doc = MovementDocumentation(
        id=uuid.uuid4(),
        movement_id=target.id,
        version=1,
        status="published",
        content=content,
        published_at=datetime.now(UTC),
    )
    db.add(doc)
    db.flush()
    return doc


def logged_set(db, profile: Profile, item: Movement, *, source, reps=None,
               hold_seconds=None, intent="training_set", analysis_id=None,
               at=None) -> WorkoutSet:
    session = WorkoutSession(
        id=uuid.uuid4(), user_id=profile.id, source=source,
        started_at=at or datetime.now(UTC),
    )
    db.add(session)
    db.flush()
    result = WorkoutSet(
        id=uuid.uuid4(), session_id=session.id, movement_id=item.id,
        position=0, source=source, performer="self", intent=intent,
        reps=reps, hold_seconds=hold_seconds, analysis_id=analysis_id,
    )
    db.add(result)
    db.flush()
    return result


def analysis_result(valid_count: int, *, target_match: bool | None = True,
                    partial_count: int = 0) -> dict:
    return {
        "outcome": "completed" if valid_count else "zero_valid_reps",
        "valid_rep_count": valid_count,
        "reps": [
            {"outcome": "valid", "target_match": target_match}
            for _ in range(valid_count)
        ] + [
            {"outcome": "partial", "target_match": target_match}
            for _ in range(partial_count)
        ],
    }


def analyzed_set(db, profile: Profile, item: Movement, documentation_id: uuid.UUID,
                 *, valid_count: int, target_match: bool | None = True,
                 partial_count: int = 0, intent: str = "normal_training") -> Analysis:
    now = datetime.now(UTC)
    analysis = Analysis(
        id=uuid.uuid4(), user_id=profile.id, movement_id=item.id,
        family_key=item.family_key, owner_kind="authenticated",
        status="completed", stage="completed", execution_intent=intent,
        safety_documentation_id=documentation_id,
        safety_ack_version="test", safety_acknowledged_at=now,
        reservation_operation_key=str(uuid.uuid4()),
        request_fingerprint="test", reservation_expires_at=now + timedelta(days=1),
        completed_at=now,
        valid_rep_count=valid_count,
        terminal_outcome="completed" if valid_count else "zero_valid_reps",
        result=analysis_result(
            valid_count, target_match=target_match, partial_count=partial_count
        ),
        progress_snapshot={}, ai_feedback_status="skipped",
    )
    db.add(analysis)
    db.flush()
    logged_set(
        db, profile, item, source="uploaded_analysis",
        reps=max(1, valid_count), analysis_id=analysis.id, at=now,
    )
    return analysis


def result(db, profile: Profile, target: Movement, *, now=None):
    evidence = ReadinessEvidenceBuilder.build(
        db, user_id=profile.id, movement_id=target.id, now=now,
    )
    return evidence, ReadinessService.evaluate(evidence)


def test_guidance_without_structured_rules_creates_no_readiness_evidence(db):
    profile = athlete(db)
    target = movement(db)
    guide = documentation(db, target)
    evidence, decision = result(db, profile, target)
    assert evidence == []
    assert guide.content["prerequisites"] == ["Demonstrate required performance"]
    assert decision.status is ReadinessStatus.UNKNOWN
    assert decision.prescription_allowed is False


def test_manual_counts_only_when_rule_explicitly_accepts_it(db):
    profile = athlete(db)
    target = movement(db)
    documentation(db, target, readiness_rule=rule(target, sources=["uploaded_analysis"]))
    logged_set(db, profile, target, source="manual", reps=8)
    assert result(db, profile, target)[1].status is ReadinessStatus.UNKNOWN
    doc = db.query(MovementDocumentation).one()
    doc.content = {**doc.content, "readiness_rules": [rule(target, sources=["manual"])]}
    evidence, decision = result(db, profile, target)
    assert decision.status is ReadinessStatus.PASS
    assert evidence[0].source == "manual"
    assert evidence[0].reference_id is not None
    assert evidence[0].observed_value == 8


def test_nonmax_below_threshold_is_unknown_but_explicit_max_test_can_fail(db):
    profile = athlete(db)
    target = movement(db)
    documentation(db, target, readiness_rule=rule(target, sources=["manual"]))
    attempt = logged_set(db, profile, target, source="manual", reps=3)
    assert result(db, profile, target)[1].status is ReadinessStatus.UNKNOWN
    attempt.intent = "max_test"
    evidence, decision = result(db, profile, target)
    assert decision.status is ReadinessStatus.FAIL
    assert evidence[0].observed_value == 3


def test_onboarding_is_provisional_and_only_used_when_allowed(db):
    now = datetime.now(UTC)
    profile = athlete(db, assessment={
        "submitted_at": now.isoformat(),
        "answers": {"max_clean_reps": {"pull_up": 6}},
    })
    target = movement(db)
    documentation(db, target, readiness_rule=rule(target, sources=["manual"]))
    assert result(db, profile, target, now=now)[1].status is ReadinessStatus.UNKNOWN
    doc = db.query(MovementDocumentation).one()
    doc.content = {
        **doc.content,
        "readiness_rules": [rule(target, sources=["initial_assessment"], age=7)],
    }
    evidence, decision = result(db, profile, target, now=now)
    assert decision.status is ReadinessStatus.PASS
    assert evidence[0].source == "initial_assessment"
    assert result(db, profile, target, now=now + timedelta(days=8))[1].status is ReadinessStatus.UNKNOWN


def test_uploaded_analysis_uses_analyzer_count_not_editable_set_count(db):
    now = datetime.now(UTC)
    profile = athlete(db)
    target = movement(db)
    doc = documentation(db, target, readiness_rule=rule(target, value=6))
    analysis = Analysis(
        id=uuid.uuid4(),
        user_id=profile.id,
        movement_id=target.id,
        family_key="vertical_pull",
        owner_kind="authenticated",
        status="completed",
        stage="completed",
        execution_intent="normal_training",
        safety_documentation_id=doc.id,
        safety_ack_version="test",
        safety_acknowledged_at=now,
        reservation_operation_key=str(uuid.uuid4()),
        request_fingerprint="test",
        reservation_expires_at=now + timedelta(days=1),
        completed_at=now,
        valid_rep_count=5,
        terminal_outcome="completed",
        result=analysis_result(5),
        progress_snapshot={},
        ai_feedback_status="skipped",
    )
    db.add(analysis)
    db.flush()
    linked = logged_set(
        db, profile, target, source="uploaded_analysis",
        reps=99, analysis_id=analysis.id, at=now,
    )
    assert result(db, profile, target, now=now)[1].status is ReadinessStatus.UNKNOWN
    analysis.valid_rep_count = 7
    analysis.result = analysis_result(7)
    evidence, decision = result(db, profile, target, now=now)
    assert decision.status is ReadinessStatus.PASS
    assert evidence[0].observed_value == 7
    assert evidence[0].reference_id == analysis.id
    linked.performer = "other"
    assert result(db, profile, target, now=now)[1].status is ReadinessStatus.UNKNOWN


def test_another_athletes_linked_analysis_does_not_count(db):
    now = datetime.now(UTC)
    owner = athlete(db)
    other = athlete(db)
    target = movement(db)
    doc = documentation(db, target, readiness_rule=rule(target))
    analysis = Analysis(
        id=uuid.uuid4(),
        user_id=other.id,
        movement_id=target.id,
        family_key="vertical_pull",
        owner_kind="authenticated",
        status="completed",
        stage="completed",
        execution_intent="normal_training",
        safety_documentation_id=doc.id,
        safety_ack_version="test",
        safety_acknowledged_at=now,
        reservation_operation_key=str(uuid.uuid4()),
        request_fingerprint="other",
        reservation_expires_at=now + timedelta(days=1),
        completed_at=now,
        valid_rep_count=10,
        terminal_outcome="completed",
        result=analysis_result(10),
        progress_snapshot={},
        ai_feedback_status="skipped",
    )
    db.add(analysis)
    db.flush()
    logged_set(
        db, other, target, source="uploaded_analysis",
        reps=10, analysis_id=analysis.id, at=now,
    )
    assert result(db, owner, target, now=now)[1].status is ReadinessStatus.UNKNOWN


def test_uploaded_analysis_requires_positive_canonical_target_match(db):
    profile = athlete(db)
    target = movement(db)
    doc = documentation(db, target, readiness_rule=rule(target))
    analysis = analyzed_set(db, profile, target, doc.id, valid_count=3,
                            target_match=False)
    assert result(db, profile, target)[1].status is ReadinessStatus.UNKNOWN
    analysis.result = analysis_result(3, target_match=None)
    assert result(db, profile, target)[1].status is ReadinessStatus.UNKNOWN
    analysis.result = analysis_result(3, target_match=True)
    evidence, decision = result(db, profile, target)
    assert decision.status is ReadinessStatus.UNKNOWN  # threshold is five
    assert evidence[0].satisfied is None  # ordinary training is not a failed max test
    analysis.terminal_outcome = "insufficient_evidence"
    analysis.result = {**analysis_result(3), "outcome": "insufficient_evidence"}
    assert result(db, profile, target)[0][0].satisfied is None


def test_target_matched_max_test_below_threshold_fails(db):
    profile = athlete(db)
    target = movement(db)
    doc = documentation(db, target, readiness_rule=rule(target, value=1))
    analyzed_set(db, profile, target, doc.id, valid_count=0, partial_count=1,
                 intent="max_test")
    evidence, decision = result(db, profile, target)
    assert decision.status is ReadinessStatus.FAIL
    assert evidence[0].source == "uploaded_analysis"
    assert evidence[0].observed_value == 0


def test_live_coach_source_is_not_yet_a_verified_measurement(db):
    profile = athlete(db)
    target = movement(db)
    documentation(db, target, readiness_rule=rule(target, sources=["live_coach"]))
    logged_set(db, profile, target, source="live_coach", reps=12)
    assert result(db, profile, target)[1].status is ReadinessStatus.UNKNOWN


def test_curated_seed_guides_preserve_unstructured_safety_prerequisites(db):
    for seed in MOVEMENTS:
        seed_movement(db, seed)
    profile = athlete(db)
    assert set(CURATED_READINESS_RULES) == {
        "close-grip-pull-up", "wide-grip-pull-up", "high-pull-up", "muscle-up"
    }
    for seed in MOVEMENTS:
        target = db.query(Movement).filter_by(slug=seed["slug"]).one()
        doc = db.query(MovementDocumentation).filter_by(
            movement_id=target.id, status="published"
        ).one()
        safety = MovementSafetyContent.model_validate(doc.content)
        original = seed["documentation"]["prerequisites"]
        assert safety.prerequisites[:len(original)] == original
        expected = CURATED_READINESS_RULES.get(seed["slug"], ())
        assert len(safety.readiness_rules or []) == len(expected)
        assert len(safety.prerequisites) == len(original) + len(expected)
        for index, (code, source_slug, requirement) in enumerate(expected):
            rule_entry = safety.readiness_rules[index]
            source = db.query(Movement).filter_by(slug=source_slug).one()
            assert rule_entry.code == code
            assert rule_entry.prerequisite_index == len(original) + index
            assert rule_entry.movement_id == source.id
            assert rule_entry.metric == "reps"
            assert rule_entry.value == 1
            assert rule_entry.max_age_days == 365
            assert rule_entry.accepted_sources == ["uploaded_analysis"]
            assert safety.prerequisites[rule_entry.prerequisite_index] == requirement
        evidence, decision = result(db, profile, target)
        assert len(evidence) == len(expected)
        assert all(item.satisfied is None for item in evidence)
        assert decision.status is ReadinessStatus.UNKNOWN


def test_curated_content_migration_matches_seed_templates():
    path = Path(__file__).parents[1] / "alembic" / "versions" / (
        "c7e8f9a0b123_curated_readiness_rules.py"
    )
    spec = spec_from_file_location("curated_readiness_migration", path)
    assert spec is not None and spec.loader is not None
    migration = module_from_spec(spec)
    spec.loader.exec_module(migration)
    assert set(migration.CURATED) == set(CURATED_READINESS_RULES)
    seeds = {item["slug"]: item for item in MOVEMENTS}
    for slug, (expected_prose, templates) in migration.CURATED.items():
        assert expected_prose == seeds[slug]["documentation"]["prerequisites"]
        assert tuple(templates) == CURATED_READINESS_RULES[slug]


@pytest.mark.parametrize("target_slug", [
    "close-grip-pull-up", "wide-grip-pull-up", "high-pull-up", "muscle-up"
])
def test_curated_pull_up_rule_accepts_only_target_matched_upload(db, target_slug):
    for seed in MOVEMENTS:
        seed_movement(db, seed)
    profile = athlete(db)
    target = db.query(Movement).filter_by(slug=target_slug).one()
    pull_up = db.query(Movement).filter_by(slug="pull-up").one()
    pull_doc = db.query(MovementDocumentation).filter_by(
        movement_id=pull_up.id, status="published"
    ).one()
    manual = logged_set(db, profile, pull_up, source="manual", reps=10)
    evidence, decision = result(db, profile, target)
    assert len(evidence) == len(CURATED_READINESS_RULES[target_slug])
    assert evidence[0].satisfied is None
    assert decision.status is ReadinessStatus.UNKNOWN
    manual.source = "self_reported"
    assert result(db, profile, target)[1].status is ReadinessStatus.UNKNOWN

    analysis = analyzed_set(db, profile, pull_up, pull_doc.id,
                            valid_count=1, target_match=False)
    assert result(db, profile, target)[1].status is ReadinessStatus.UNKNOWN
    analysis.result = analysis_result(1, target_match=True)
    evidence, decision = result(db, profile, target)
    assert evidence[0].satisfied is True
    assert evidence[0].source == "uploaded_analysis"
    assert decision.status is (
        ReadinessStatus.UNKNOWN if target_slug == "muscle-up" else ReadinessStatus.PASS
    )

    if target_slug == "muscle-up":
        high = db.query(Movement).filter_by(slug="high-pull-up").one()
        high_doc = db.query(MovementDocumentation).filter_by(
            movement_id=high.id, status="published"
        ).one()
        analyzed_set(db, profile, high, high_doc.id, valid_count=1)
        evidence, decision = result(db, profile, target)
        assert [item.satisfied for item in evidence] == [True, True]
        assert decision.status is ReadinessStatus.PASS


def test_curated_rule_fails_on_verified_zero_rep_max_test(db):
    for seed in MOVEMENTS:
        seed_movement(db, seed)
    profile = athlete(db)
    target = db.query(Movement).filter_by(slug="close-grip-pull-up").one()
    pull_up = db.query(Movement).filter_by(slug="pull-up").one()
    pull_doc = db.query(MovementDocumentation).filter_by(
        movement_id=pull_up.id, status="published"
    ).one()
    analyzed_set(db, profile, pull_up, pull_doc.id, valid_count=0,
                 partial_count=1, intent="max_test")
    evidence, decision = result(db, profile, target)
    assert evidence[-1].satisfied is False
    assert decision.status is ReadinessStatus.FAIL


def test_duration_rule_uses_hold_not_reps(db):
    profile = athlete(db)
    target = movement(db, slug="front-lever", kind="duration")
    documentation(db, target, readiness_rule=rule(
        target, sources=["self_reported"], metric="hold_seconds", value=10,
    ))
    logged_set(db, profile, target, source="self_reported", hold_seconds=12)
    evidence, decision = result(db, profile, target)
    assert decision.status is ReadinessStatus.PASS
    assert evidence[0].observed_value == 12


def test_avoidance_fails_even_with_qualifying_evidence(db):
    target = movement(db)
    profile = athlete(db, avoided=[target.id])
    documentation(db, target, readiness_rule=rule(target, sources=["manual"]))
    logged_set(db, profile, target, source="manual", reps=8)
    evidence, decision = result(db, profile, target)
    assert [item.satisfied for item in evidence] == [False, True]
    assert decision.status is ReadinessStatus.FAIL


def test_unmapped_prose_does_not_block_passing_structured_rule(db):
    profile = athlete(db)
    target = movement(db)
    documentation(
        db, target, readiness_rule=rule(target, sources=["manual"]),
        prerequisites=["Five reps", "Pain-free shoulder mobility"],
    )
    logged_set(db, profile, target, source="manual", reps=8)
    evidence, decision = result(db, profile, target)
    assert [item.satisfied for item in evidence] == [True]
    assert decision.status is ReadinessStatus.PASS
    guide = db.query(MovementDocumentation).filter_by(movement_id=target.id).one()
    assert guide.content["prerequisites"] == [
        "Five reps", "Pain-free shoulder mobility"
    ]


def test_publishing_rejects_rule_with_wrong_source_movement_type(db):
    admin = athlete(db)
    source = movement(db, slug="front-lever", kind="duration")
    target = movement(db, slug="back-lever", kind="duration")
    draft = MovementDocumentation(
        id=uuid.uuid4(),
        movement_id=target.id,
        version=1,
        status="draft",
        content={
            "notice": "Move with control.",
            "difficulty": "advanced",
            "stressed_areas": ["shoulders"],
            "prerequisites": ["Five repetitions"],
            "cautions": [],
            "stop_conditions": ["Stop for pain"],
            "readiness_rules": [rule(source, metric="reps")],
        },
    )
    db.add(draft)
    db.flush()
    with pytest.raises(InvalidSafetyContentError):
        MovementDocumentationService.publish_draft(
            db, draft.id, admin.id
        )


def test_published_rule_survives_json_round_trip_and_prose_edit_invalidates_mapping(db):
    admin = athlete(db)
    source = movement(db)
    target = movement(db, slug="high-pull-up")
    content = {
        "notice": "Move with control.",
        "difficulty": "advanced",
        "stressed_areas": ["shoulders"],
        "prerequisites": ["Five pull-ups"],
        "cautions": [],
        "stop_conditions": ["Stop for pain"],
        "readiness_rules": [rule(source, sources=["manual"])],
    }
    draft = MovementDocumentation(
        id=uuid.uuid4(),
        movement_id=target.id,
        version=1,
        status="draft",
        content=content,
    )
    db.add(draft)
    db.flush()
    published = MovementDocumentationService.publish_draft(
        db, draft.id, admin.id
    )
    assert published.content["readiness_rules"][0]["movement_id"] == str(source.id)
    assert published.content["readiness_rules"][0]["value"] == "5"

    next_draft = MovementDocumentationService.create_draft_from_published(
        db, target.id, admin.id
    )
    updated = MovementDocumentationService.update_draft(
        db,
        next_draft.id,
        MovementDocumentationUpdate(
            content={"prerequisites": ["Controlled pull-ups"]}
        ),
    )
    assert updated.content["readiness_rules"] is None


@pytest.mark.parametrize("change", [
    lambda r: r.update(type="ai_interpretation"),
    lambda r: r.update(value=0),
    lambda r: r.update(metric="reps", value=1.5),
    lambda r: r.update(accepted_sources=[]),
    lambda r: r.update(extra="untrusted"),
])
def test_invalid_rule_content_is_rejected(change):
    movement_id = uuid.uuid4()
    entry = {
        "code": "minimum_source_performance",
        "type": "movement_performance",
        "prerequisite_index": 0,
        "movement_id": str(movement_id),
        "metric": "reps",
        "operator": ">=",
        "value": 5,
        "max_age_days": 30,
        "accepted_sources": ["uploaded_analysis"],
    }
    change(entry)
    with pytest.raises(ValidationError):
        MovementSafetyContent.model_validate({
            "notice": "Control the movement.",
            "difficulty": "beginner",
            "stressed_areas": ["shoulders"],
            "prerequisites": ["Five reps"],
            "cautions": [],
            "stop_conditions": ["Stop for pain"],
            "readiness_rules": [entry],
        })
