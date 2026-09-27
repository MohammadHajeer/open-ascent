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
from app.models.readiness_self_report import ReadinessSelfReport
from app.models.training import WorkoutSession, WorkoutSet
from app.schemas.movement_documentation import MovementDocumentationUpdate
from app.schemas.movement_safety import MovementSafetyContent
from app.schemas.plan_generation import LibraryPlanRequest
from app.schemas.readiness import ReadinessStatus
from app.schemas.readiness_check import ReadinessAnswersInput
from app.schemas.training_plan import WeeklyPlanCandidate
from app.services.movement_documentation import (
    InvalidSafetyContentError,
    MovementDocumentationService,
)
from app.services.plan_modes import planning_context
from app.services.readiness import ReadinessService
from app.services.readiness_check import _published_question, preflight, store_answers
from app.services.readiness_evidence import ReadinessEvidenceBuilder
from app.services.training_plan import PlanValidationError
from app.services.training_plan import validate_candidate as _validate_candidate
from scripts.seed_movements import (
    CURATED_READINESS_RULES,
    FOUNDATION_READINESS_RULES,
    MOVEMENTS,
    seed_movement,
)


@compiles(JSONB, "sqlite")
def _jsonb_sqlite(_type, _compiler, **_kwargs):
    return "JSON"


@pytest.fixture
def db():
    engine = create_engine("sqlite://", poolclass=StaticPool)

    @event.listens_for(engine, "connect")
    def register_functions(connection, _record):
        connection.create_function("gen_random_uuid", 0, lambda: uuid.uuid4().hex)
        connection.create_function("now", 0, lambda: datetime.now(UTC).strftime("%Y-%m-%d %H:%M:%S.%f"))

    tables = (
        Profile.__table__,
        Movement.__table__,
        MovementDocumentation.__table__,
        ReadinessSelfReport.__table__,
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
        foundation = FOUNDATION_READINESS_RULES.get(seed["slug"])
        assert len(safety.readiness_rules or []) == len(expected) + int(bool(foundation))
        assert len(safety.prerequisites) == len(original) + len(expected) + int(bool(foundation))
        if foundation:
            assert safety.readiness_rules[0].code == foundation[0]
            assert safety.readiness_rules[0].accepted_sources == ["manual", "uploaded_analysis", "structured_self_report"]
            assert safety.readiness_rules[0].max_age_days == 90
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
        assert len(evidence) == len(expected) + int(bool(foundation))
        assert all(item.satisfied is None for item in evidence)
        assert decision.status is ReadinessStatus.UNKNOWN


def test_foundation_rules_accept_recent_manual_sets_without_measured_capability(db):
    for seed in MOVEMENTS:
        seed_movement(db, seed)
    profile = athlete(db)
    for slug, (_code, threshold) in FOUNDATION_READINESS_RULES.items():
        target = db.query(Movement).filter_by(slug=slug).one()
        assert result(db, profile, target)[1].status is ReadinessStatus.UNKNOWN
        logged_set(db, profile, target, source="manual", reps=threshold)
        evidence, decision = result(db, profile, target)
        assert decision.status is ReadinessStatus.PASS
        assert evidence[0].source == "manual"


def test_zero_history_profile_check_unlocks_only_foundation_rules_for_owner(db):
    for seed in MOVEMENTS:
        seed_movement(db, seed)
    profile = athlete(db)
    profile.coaching_context = {"equipment": ["pull_up_bar", "dip_bars"]}
    other = athlete(db)
    request = LibraryPlanRequest(client_request_id=uuid.uuid4(), mode="profile")
    check = preflight(db, profile.id, request)
    assert check["status"] == "check_required"
    assert {item["rule_code"] for item in check["questions"]} == {
        "recent_logged_push_up", "recent_logged_pull_up", "recent_logged_dips"
    }
    answers = ReadinessAnswersInput.model_validate({"answers": [
        {**{key: question[key] for key in ("movement_id", "documentation_id", "rule_code")},
         "response": "able"}
        for question in check["questions"]
    ]})
    store_answers(db, profile.id, answers)
    assert preflight(db, profile.id, request)["status"] == "ready"
    assert db.query(ReadinessSelfReport).filter_by(user_id=profile.id).count() == 3
    assert profile.athlete_state == {}
    assert db.query(Analysis).filter_by(user_id=profile.id).count() == 0
    for slug in ("pull-up", "push-up", "dips"):
        target = db.query(Movement).filter_by(slug=slug).one()
        evidence, decision = result(db, profile, target)
        assert decision.status is ReadinessStatus.PASS
        assert evidence[0].source == "structured_self_report"
        assert evidence[0].reference_id is not None
        assert result(db, other, target)[1].status is ReadinessStatus.UNKNOWN
    advanced = db.query(Movement).filter_by(slug="muscle-up").one()
    assert result(db, profile, advanced)[1].status is ReadinessStatus.UNKNOWN
    pull_up = db.query(Movement).filter_by(slug="pull-up").one()
    push_up = db.query(Movement).filter_by(slug="push-up").one()
    proposal = {"title": "Starter", "days": [{"day_index": 1, "exercises": [
        {"movement_id": pull_up.id, "sets": 3, "reps": 1, "rest_seconds": 90},
        {"movement_id": push_up.id, "sets": 3, "reps": 5, "rest_seconds": 90},
    ]}]}
    validate_candidate(db, profile.id, WeeklyPlanCandidate.model_validate(proposal))
    # A Quick readiness "able" confirms only the rule threshold, never more.
    proposal["days"][0]["exercises"][0]["reps"] = 2
    with pytest.raises(PlanValidationError, match="outside the 1-1 range"):
        validate_candidate(db, profile.id, WeeklyPlanCandidate.model_validate(proposal))
    proposal["days"][0]["exercises"][0]["movement_id"] = advanced.id
    with pytest.raises(PlanValidationError, match="cannot be prescribed yet"):
        validate_candidate(db, profile.id, WeeklyPlanCandidate.model_validate(proposal))
    proposal["days"][0]["exercises"][0].update(movement_id=pull_up.id, reps=1)
    proposal["days"] = [{**proposal["days"][0], "day_index": index} for index in range(1, 5)]
    with pytest.raises(PlanValidationError, match="the current limit is 3") as exc:
        validate_candidate(db, profile.id, WeeklyPlanCandidate.model_validate(proposal))
    assert exc.value.code == "availability_exceeded"
    logged_set(db, profile, pull_up, source="manual", reps=1)
    assert result(db, profile, pull_up)[0][0].source == "manual"


def test_negative_and_avoid_answers_block_and_later_training_can_supersede_not_yet(db):
    for seed in MOVEMENTS:
        seed_movement(db, seed)
    profile = athlete(db)
    target = db.query(Movement).filter_by(slug="push-up").one()
    doc = MovementDocumentationService.get_published(db, target.id)
    base = {"movement_id": target.id, "documentation_id": doc.id,
            "rule_code": "recent_logged_push_up"}
    store_answers(db, profile.id, ReadinessAnswersInput.model_validate({
        "answers": [{**base, "response": "not_yet"}]
    }))
    assert result(db, profile, target)[1].status is ReadinessStatus.FAIL
    report = db.query(ReadinessSelfReport).filter_by(user_id=profile.id).one()
    report.reported_at = datetime.now(UTC) - timedelta(days=1)
    db.flush()
    logged_set(db, profile, target, source="manual", reps=5)
    evidence, decision = result(db, profile, target)
    assert decision.status is ReadinessStatus.PASS
    assert evidence[0].source == "manual"
    store_answers(db, profile.id, ReadinessAnswersInput.model_validate({
        "answers": [{**base, "response": "avoid"}]
    }))
    assert result(db, profile, target)[1].status is ReadinessStatus.FAIL


def test_muscle_up_goal_uses_foundation_check_without_unlocking_goal(db):
    for seed in MOVEMENTS:
        seed_movement(db, seed)
    profile = athlete(db)
    profile.coaching_context = {"equipment": ["pull_up_bar", "dip_bars"]}
    muscle_up = db.query(Movement).filter_by(slug="muscle-up").one()
    request = LibraryPlanRequest(client_request_id=uuid.uuid4(), mode="goal",
                                 goal_movement_id=muscle_up.id)
    check = preflight(db, profile.id, request)
    assert check["status"] == "check_required"
    assert {item["movement_name"] for item in check["questions"]} == {"Pull-Up", "Dips"}
    store_answers(db, profile.id, ReadinessAnswersInput.model_validate({"answers": [
        {**{key: question[key] for key in ("movement_id", "documentation_id", "rule_code")},
         "response": "able"}
        for question in check["questions"]
    ]}))
    assert preflight(db, profile.id, request)["status"] == "ready"
    pull_up = db.query(Movement).filter_by(slug="pull-up").one()
    safe = WeeklyPlanCandidate.model_validate({
        "schema_version": 2, "path_key": "muscle-up", "goal_slug": "muscle-up",
        "title": "Toward Muscle-Up", "days": [{
            "day_index": 1, "exercises": [{"movement_id": pull_up.id, "sets": 3,
                                           "reps": 1, "rest_seconds": 90}]
        }],
    })
    _validate_candidate(db, profile.id, safe, mode="goal")
    blocked = safe.model_copy(deep=True)
    blocked.days[0].exercises[0].movement_id = muscle_up.id
    with pytest.raises(PlanValidationError, match="cannot be prescribed yet"):
        _validate_candidate(db, profile.id, blocked, mode="goal")


def test_stale_guide_answer_cannot_unlock_new_published_guide(db):
    for seed in MOVEMENTS:
        seed_movement(db, seed)
    profile = athlete(db)
    target = db.query(Movement).filter_by(slug="push-up").one()
    old = MovementDocumentationService.get_published(db, target.id)
    store_answers(db, profile.id, ReadinessAnswersInput.model_validate({"answers": [{
        "movement_id": target.id, "documentation_id": old.id,
        "rule_code": "recent_logged_push_up", "response": "able"
    }]}))
    old.status = "archived"
    replacement = MovementDocumentation(
        movement_id=target.id, version=old.version + 1, status="published",
        content=old.content, published_at=datetime.now(UTC),
    )
    db.add(replacement)
    db.flush()
    assert result(db, profile, target)[1].status is ReadinessStatus.UNKNOWN
    with pytest.raises(ValueError, match="question changed"):
        store_answers(db, profile.id, ReadinessAnswersInput.model_validate({"answers": [{
            "movement_id": target.id, "documentation_id": old.id,
            "rule_code": "recent_logged_push_up", "response": "able"
        }]}))


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


def test_self_report_migration_targets_only_seeded_foundation_rules():
    path = Path(__file__).parents[1] / "alembic" / "versions" / (
        "b71e2c934af0_structured_readiness_self_report.py"
    )
    spec = spec_from_file_location("structured_readiness_migration", path)
    assert spec is not None and spec.loader is not None
    migration = module_from_spec(spec)
    spec.loader.exec_module(migration)
    assert migration.FOUNDATIONS == FOUNDATION_READINESS_RULES


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


def test_publishing_rejects_self_report_for_advanced_rule(db):
    admin = athlete(db)
    source = movement(db, slug="pull-up")
    target = movement(db, slug="muscle-up")
    entry = rule(source, sources=["uploaded_analysis", "structured_self_report"], value=1)
    draft = MovementDocumentation(
        id=uuid.uuid4(), movement_id=target.id, version=1, status="draft",
        content={"notice": "Move with control.", "difficulty": "advanced",
                 "stressed_areas": ["shoulders"], "prerequisites": ["One valid pull-up"],
                 "cautions": [], "stop_conditions": ["Stop for pain"],
                 "readiness_rules": [entry]},
    )
    db.add(draft)
    db.flush()
    with pytest.raises(InvalidSafetyContentError, match="Structured self-report"):
        MovementDocumentationService.publish_draft(db, draft.id, admin.id)


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
            edit_revision=next_draft.edit_revision,
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


def validate_candidate(db, user_id, proposal: WeeklyPlanCandidate) -> None:
    """Validate a profile-mode plan through the current (version 2) planner."""
    document = {**proposal.model_dump(mode="json"), "schema_version": 2, "path_key": "general"}
    _validate_candidate(db, user_id, WeeklyPlanCandidate.model_validate(document), mode="profile")


def onboarded_athlete(db, reps: dict, *, submitted_at=None, equipment=("pull_up_bar",)) -> Profile:
    profile = athlete(db, assessment={
        "submitted_at": (submitted_at or datetime.now(UTC)).isoformat(),
        "answers": {"training_experience": "some", "max_clean_reps": reps},
    })
    profile.coaching_context = {"equipment": list(equipment),
                                "availability": {"days_per_week": 3, "minutes_per_session": 45}}
    db.flush()
    return profile


def test_onboarding_answers_let_a_new_athlete_reach_a_conservative_starter_plan(db):
    for seed in MOVEMENTS:
        seed_movement(db, seed)
    profile = onboarded_athlete(db, {"pull_up": 20, "push_up": 40, "dips": None})
    request = LibraryPlanRequest(client_request_id=uuid.uuid4(), mode="profile")
    # Onboarding already answered the foundation question: no extra check.
    assert preflight(db, profile.id, request) == {"status": "ready", "questions": []}
    assert db.query(ReadinessSelfReport).filter_by(user_id=profile.id).count() == 0
    pull_up = db.query(Movement).filter_by(slug="pull-up").one()
    push_up = db.query(Movement).filter_by(slug="push-up").one()
    for target, threshold in ((pull_up, 1), (push_up, 5)):
        evidence, decision = result(db, profile, target)
        assert decision.status is ReadinessStatus.PASS
        # Provisional, labelled, and credited only at the rule threshold.
        assert evidence[0].source == "onboarding_self_report"
        assert evidence[0].observed_value == threshold
    dips = db.query(Movement).filter_by(slug="dips").one()
    assert result(db, profile, dips)[1].status is ReadinessStatus.UNKNOWN
    for slug in ("muscle-up", "high-pull-up", "close-grip-pull-up"):
        advanced = db.query(Movement).filter_by(slug=slug).one()
        assert result(db, profile, advanced)[1].status is ReadinessStatus.UNKNOWN
    assert profile.athlete_state == {}
    assert db.query(Analysis).filter_by(user_id=profile.id).count() == 0

    proposal = {"title": "Starter", "days": [{"day_index": 1, "exercises": [
        {"movement_id": pull_up.id, "sets": 3, "reps": 8, "rest_seconds": 120},
        {"movement_id": push_up.id, "sets": 3, "reps": 15, "rest_seconds": 90},
    ]}]}
    # The 20 / 40 self-report scales dosage provisionally (7-11 and 13-22).
    validate_candidate(db, profile.id, WeeklyPlanCandidate.model_validate(proposal))
    for change in ({"reps": 1}, {"reps": 12}, {"sets": 4}):
        proposal["days"][0]["exercises"][0].update({"sets": 3, "reps": 8, **change})
        with pytest.raises(PlanValidationError) as exc:
            validate_candidate(db, profile.id, WeeklyPlanCandidate.model_validate(proposal))
        assert exc.value.code == "dosage_out_of_range"
    proposal["days"][0]["exercises"][0].update(sets=3, reps=8)
    proposal["days"] = [{**proposal["days"][0], "day_index": index} for index in range(1, 5)]
    with pytest.raises(PlanValidationError, match="the current limit is 3"):
        validate_candidate(db, profile.id, WeeklyPlanCandidate.model_validate(proposal))
    muscle_up = db.query(Movement).filter_by(slug="muscle-up").one()
    blocked = {"title": "Too soon", "days": [{"day_index": 1, "exercises": [
        {"movement_id": muscle_up.id, "sets": 1, "reps": 1, "rest_seconds": 120}]}]}
    with pytest.raises(PlanValidationError, match="cannot be prescribed yet"):
        validate_candidate(db, profile.id, WeeklyPlanCandidate.model_validate(blocked))

    # Logged training supersedes the onboarding answer.
    logged_set(db, profile, pull_up, source="manual", reps=3)
    assert result(db, profile, pull_up)[0][0].source == "manual"


def test_onboarding_below_threshold_fails_until_a_quick_readiness_answer_supersedes(db):
    for seed in MOVEMENTS:
        seed_movement(db, seed)
    profile = onboarded_athlete(db, {"pull_up": 0, "push_up": 3, "dips": None},
                                submitted_at=datetime.now(UTC) - timedelta(days=1))
    push_up = db.query(Movement).filter_by(slug="push-up").one()
    evidence, decision = result(db, profile, push_up)
    assert decision.status is ReadinessStatus.FAIL
    assert (evidence[0].source, evidence[0].observed_value) == ("onboarding_self_report", 3)
    request = LibraryPlanRequest(client_request_id=uuid.uuid4(), mode="profile")
    metadata = {"mode": "profile", "note": None}
    # Known "not yet" answers unlock only the guides' easier options.
    assert preflight(db, profile.id, request)["status"] == "ready"
    pool = planning_context(db, profile.id, metadata).pool
    assert {entry.name for entry in pool.values() if entry.kind == "movement"} == set()
    assert {"Eccentric Pull-Up", "Incline Push-Up"} <= {entry.name for entry in pool.values()}
    retry = _published_question(db, push_up)
    store_answers(db, profile.id, ReadinessAnswersInput.model_validate({"answers": [{
        **{key: retry[key] for key in ("movement_id", "documentation_id", "rule_code")},
        "response": "able",
    }]}))
    assert preflight(db, profile.id, request)["status"] == "ready"
    assert result(db, profile, push_up)[0][0].source == "structured_self_report"
    assert str(push_up.id) in planning_context(db, profile.id, metadata).pool


@pytest.mark.parametrize("reps,age_days", [
    ({"pull_up": None, "push_up": None, "dips": None}, 0),
    ({"pull_up": 10, "push_up": 30, "dips": 10}, 91),
])
def test_unanswered_or_stale_onboarding_still_uses_quick_readiness(db, reps, age_days):
    for seed in MOVEMENTS:
        seed_movement(db, seed)
    profile = onboarded_athlete(db, reps, submitted_at=datetime.now(UTC) - timedelta(days=age_days))
    check = preflight(db, profile.id, LibraryPlanRequest(client_request_id=uuid.uuid4(), mode="profile"))
    assert check["status"] == "check_required"
    assert {item["rule_code"] for item in check["questions"]} == {
        "recent_logged_push_up", "recent_logged_pull_up"
    }


def test_seeded_foundation_opt_in_migration_matches_only_exact_demo_seed_rules(db):
    path = Path(__file__).parents[1] / "alembic" / "versions" / (
        "e9f0a1b2c3d4_opt_in_seeded_foundation_self_report.py"
    )
    spec = spec_from_file_location("seeded_foundation_migration", path)
    assert spec is not None and spec.loader is not None
    migration = module_from_spec(spec)
    spec.loader.exec_module(migration)
    assert migration.FOUNDATIONS == FOUNDATION_READINESS_RULES
    for seed in MOVEMENTS:
        seed_movement(db, seed)
    for slug, (code, threshold) in FOUNDATION_READINESS_RULES.items():
        target = db.query(Movement).filter_by(slug=slug).one()
        current = MovementDocumentationService.get_published(db, target.id).content
        index = current["readiness_rules"][0]["prerequisite_index"]
        # The migrated wording is exactly what seed_movements publishes today.
        assert current["prerequisites"][index] == migration._opted_in_prerequisite(target.name, threshold)
        legacy = {**current, "prerequisites": [
            *current["prerequisites"][:index], migration._seeded_prerequisite(target.name, threshold),
        ], "readiness_rules": [{**current["readiness_rules"][0],
                                "accepted_sources": ["manual", "uploaded_analysis"]}]}
        assert migration._is_legacy_seed_rule(legacy, target.id, target.name, code, threshold)
        edited = {**legacy, "prerequisites": [*legacy["prerequisites"][:-1], "Admin wording"]}
        assert not migration._is_legacy_seed_rule(edited, target.id, target.name, code, threshold)
        assert not migration._is_legacy_seed_rule(current, target.id, target.name, code, threshold)
