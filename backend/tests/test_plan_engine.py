"""Deterministic goal-path, capability, dosage, and plan-sanity scenarios.

Each scenario runs against the real seeded movement catalog and its published
readiness rules in an isolated in-memory database. No model is called except
through a fake provider in the shared-planner test.
"""

from __future__ import annotations

import json
import uuid
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

import pytest
from pydantic import ValidationError
from sqlalchemy import create_engine, event, select, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.models.analysis import Analysis
from app.models.coach import CoachGeneration, Conversation, Message
from app.models.enums import FeatureKey, PlanCode
from app.models.movement import Movement
from app.models.movement_documentation import MovementDocumentation
from app.models.profile import Profile
from app.models.readiness_self_report import ReadinessSelfReport
from app.models.training import (
    TrainingPlan,
    TrainingPlanPreview,
    WorkoutSession,
    WorkoutSet,
)
from app.schemas.plan_generation import LibraryPlanRequest
from app.schemas.training_plan import WeeklyPlanCandidate, WeeklyPlanProposal
from app.services import coach, plan_modes, training_plan
from app.services import coach_plan_generation as plan_generation
from app.services.coach_context import build_coach_context
from app.services.coach_tools import CoachToolContext, execute_tool
from app.services.goal_paths import goal_slug_from_text
from app.services.readiness_check import preflight
from app.services.supporting_exercises import CATALOG, get_supporting_exercise
from app.subscriptions.catalog import PLAN_CATALOG
from scripts.seed_movements import MOVEMENTS, seed_movement

NOW = datetime.now(UTC)
TABLES = (
    Profile, Movement, MovementDocumentation, ReadinessSelfReport, Analysis, Conversation,
    Message, CoachGeneration, TrainingPlan, TrainingPlanPreview, WorkoutSession, WorkoutSet,
)


@compiles(JSONB, "sqlite")
def _jsonb_sqlite(_type, _compiler, **_kwargs):
    return "JSON"


@pytest.fixture
def factory(monkeypatch):
    engine = create_engine("sqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False})

    @event.listens_for(engine, "connect")
    def register_functions(connection, _record):
        connection.create_function("gen_random_uuid", 0, lambda: uuid.uuid4().hex)
        connection.create_function("now", 0, lambda: datetime.now(UTC).strftime("%Y-%m-%d %H:%M:%S.%f"))

    tables = [model.__table__ for model in TABLES]
    defaults = [(column, column.server_default) for table in tables for column in table.columns
                if isinstance(column.type, JSONB)]
    partial = [(table, index) for table in tables for index in list(table.indexes)
               if index.dialect_options["postgresql"].get("where") is not None]
    for column, _ in defaults:
        column.server_default = None
    for table, index in partial:
        table.indexes.remove(index)
    try:
        for table in tables:
            table.create(engine)
    finally:
        for column, default in defaults:
            column.server_default = default
        for table, index in partial:
            table.indexes.add(index)
    with engine.begin() as connection:
        connection.execute(text("DROP INDEX IF EXISTS uq_workout_sessions_one_active_per_user"))
    sessions = sessionmaker(engine, expire_on_commit=False)
    with sessions() as db:
        for seed in MOVEMENTS:
            seed_movement(db, seed)
        db.commit()
    monkeypatch.setattr(coach, "SessionLocal", sessions)
    monkeypatch.setattr(plan_generation, "SessionLocal", sessions)
    yield sessions
    engine.dispose()


def ids(db) -> dict[str, uuid.UUID]:
    return {movement.slug: movement.id for movement in db.scalars(select(Movement))}


def athlete(db, *, pull_up=None, push_up=None, dips=None, equipment=("pull_up_bar",),
            days=3, minutes=60, core="building", onboarded=True) -> Profile:
    answers = {
        "training_experience": "some",
        "max_clean_reps": {"pull_up": pull_up, "push_up": push_up, "dips": dips},
        "dimension_stage": {"pulling": "building", "pushing": "building", "core": core,
                            "balance": "unknown", "statics": "unknown"},
    }
    profile = Profile(
        id=uuid.uuid4(), display_name="Athlete",
        coaching_context={"primary_goal": "skill", "equipment": list(equipment),
                          "availability": {"days_per_week": days, "minutes_per_session": minutes}},
        initial_assessment={"submitted_at": (NOW - timedelta(days=5)).isoformat(), "answers": answers}
        if onboarded else {},
        athlete_state={},
    )
    db.add(profile)
    db.commit()
    return profile


def log(db, profile, slug, reps, *, days_ago, intent="training_set"):
    started = NOW - timedelta(days=days_ago)
    session = WorkoutSession(user_id=profile.id, source="manual", started_at=started,
                             completed_at=started + timedelta(minutes=30))
    db.add(session)
    db.flush()
    for position, value in enumerate(reps):
        db.add(WorkoutSet(session_id=session.id, movement_id=ids(db)[slug], position=position,
                          source="manual", performer="self", intent=intent, reps=value))
    db.commit()


def measured(db, profile, slug, count, *, days_ago, intent="max_test"):
    """An analyzer result for a target-matched, self-performed set."""
    at = NOW - timedelta(days=days_ago)
    movement = db.get(Movement, ids(db)[slug])
    doc = db.scalar(select(MovementDocumentation).where(
        MovementDocumentation.movement_id == movement.id, MovementDocumentation.status == "published"))
    analysis = Analysis(
        id=uuid.uuid4(), user_id=profile.id, movement_id=movement.id, family_key=movement.family_key,
        owner_kind="authenticated", status="completed", stage="completed",
        execution_intent="max_test" if intent == "max_test" else "normal_training",
        safety_documentation_id=doc.id, safety_ack_version="test", safety_acknowledged_at=at,
        reservation_operation_key=str(uuid.uuid4()), request_fingerprint="test",
        reservation_expires_at=at + timedelta(days=1), completed_at=at, valid_rep_count=count,
        terminal_outcome="completed",
        result={"outcome": "completed", "valid_rep_count": count,
                "reps": [{"outcome": "valid", "target_match": True} for _ in range(count)]},
        progress_snapshot={}, ai_feedback_status="skipped",
    )
    db.add(analysis)
    session = WorkoutSession(user_id=profile.id, source="uploaded_analysis", started_at=at,
                             completed_at=at + timedelta(minutes=5))
    db.add(session)
    db.flush()
    db.add(WorkoutSet(session_id=session.id, movement_id=movement.id, analysis_id=analysis.id,
                      position=0, source="uploaded_analysis", performer="self", intent=intent, reps=count))
    db.commit()


def goal(db, profile, slug=None):
    if slug is None:
        metadata = {"mode": "profile", "note": None}
    else:
        movement = db.get(Movement, ids(db)[slug])
        metadata = {"mode": "goal", "note": None,
                    "goal": {"movement_id": str(movement.id), "name": movement.name}}
    return plan_modes.planning_context(db, profile.id, metadata), metadata


def plan(context, days: dict[int, list[tuple]]) -> WeeklyPlanCandidate:
    """days: {day_index: [(slug_or_key, sets, amount, rest_seconds)]}"""
    exercises = {}
    for index, items in days.items():
        exercises[index] = []
        for ref, sets, amount, rest in items:
            entry = next(entry for entry in context.pool.values()
                         if entry.supporting_key == ref or entry.name == ref)
            exercises[index].append({
                "movement_id": str(entry.movement_id) if entry.movement_id else None,
                "supporting_exercise_id": entry.supporting_key,
                "sets": sets, "reps": amount if entry.target == "reps" else None,
                "hold_seconds": amount if entry.target == "hold_seconds" else None,
                "rest_seconds": rest, "notes": None, "explanation": entry.explanation,
            })
    return WeeklyPlanCandidate.model_validate({
        "schema_version": 2, "title": "Week", "summary": None, "path_key": context.path.key,
        "goal_slug": context.goal_slug, "catalog_version": 1,
        "days": [{"day_index": index, "label": None, "exercises": items} for index, items in exercises.items()],
    })


def raw_plan(context, exercises: list[dict]) -> WeeklyPlanCandidate:
    return WeeklyPlanCandidate.model_validate({
        "schema_version": 2, "title": "Week", "path_key": context.path.key,
        "goal_slug": context.goal_slug, "catalog_version": 1,
        "days": [{"day_index": 1, "exercises": exercises}],
    })


def rejects(db, profile, candidate, mode, code):
    with pytest.raises(training_plan.PlanValidationError) as exc:
        training_plan.validate_candidate(db, profile.id, candidate, mode=mode)
    assert exc.value.code == code, str(exc.value)
    return exc.value


# Scenario A: a complete beginner receives a conservative foundation plan.
def test_beginner_gets_conservative_foundation_and_regressions(factory):
    with factory() as db:
        profile = athlete(db, pull_up=2, push_up=6)
        context, _ = goal(db, profile)
        pool = {entry.name: entry for entry in context.pool.values()}
        assert pool["Pull-Up"].bounds.amount == (1, 1) and pool["Pull-Up"].bounds.sets == (2, 3)
        assert pool["Push-Up"].bounds.amount == (2, 3)
        # Regressions are relevant precisely because foundation capability is low.
        assert {"Eccentric Pull-Up", "Incline Push-Up", "Scapular Pull-Up"} <= set(pool)
        assert context.limits.provisional_only and context.limits.max_training_days == 3
        sane = plan(context, {
            1: [("Pull-Up", 3, 1, 150), ("negative-pull-up", 3, 3, 120), ("incline-push-up", 3, 10, 90)],
            3: [("Push-Up", 3, 3, 90), ("scapular-pull-up", 2, 8, 60), ("negative-pull-up", 2, 3, 120)],
            5: [("Pull-Up", 3, 1, 150), ("incline-push-up", 3, 10, 90), ("hollow-body-hold", 2, 20, 60)],
        })
        training_plan.validate_candidate(db, profile.id, sane, mode="profile")
        # Excessive per-set work, days, and weekly volume are rejected.
        rejects(db, profile, plan(context, {1: [("Pull-Up", 3, 5, 150), ("Push-Up", 3, 3, 90)]}),
                "profile", "dosage_out_of_range")
        rejects(db, profile, plan(context, {day: [("Pull-Up", 3, 1, 150), ("Push-Up", 3, 3, 90)]
                                            for day in (1, 2, 3, 4)}), "profile", "availability_exceeded")
        heavy = {day: [("Pull-Up", 3, 1, 150), ("negative-pull-up", 4, 3, 120),
                       ("scapular-pull-up", 4, 8, 60), ("Push-Up", 3, 3, 90)] for day in (1, 3, 5)}
        rejects(db, profile, plan(context, heavy), "profile", "weekly_volume_exceeded")


# Scenario B: 20 self-reported Pull-Ups toward Front Lever.
def test_strong_puller_front_lever_path(factory):
    with factory() as db:
        profile = athlete(db, pull_up=20, push_up=40, minutes=75)
        context, _ = goal(db, profile, "front-lever")
        pool = {entry.name: entry for entry in context.pool.values()}
        assert context.path.key == "front-lever"
        # The goal stays the destination and never becomes ready by selection.
        assert "Front Lever" not in pool
        assert context.goal_status == {"movement": "Front Lever", "prescribable": False,
                                       "why_not": ["No trustworthy readiness evidence for this movement yet."]}
        # Provisional capability is used, discounted, and never a 1-rep ceiling.
        assert pool["Pull-Up"].bounds.amount == (7, 11) and pool["Pull-Up"].provisional
        assert "self-reported max of 20" in pool["Pull-Up"].explanation
        assert pool["Tuck Front Lever Hold"].role == "goal_specific"
        assert pool["Ice-Cream Maker"].kind == "supporting"
        assert pool["Push-Up"].role == "balance"
        assert "Eccentric Pull-Up" not in pool  # a regression this athlete does not need
        # The old 3 x 3 (or 3 x 1) Pull-Up prescription is now rejected as trivial.
        trivial = plan(context, {1: [("Pull-Up", 3, 3, 120), ("tuck-front-lever-hold", 4, 8, 120)]})
        rejects(db, profile, trivial, "goal", "dosage_out_of_range")
        front_lever = ids(db)["front-lever"]
        error = rejects(db, profile, raw_plan(context, [{"movement_id": str(front_lever), "sets": 3,
                                                          "hold_seconds": 8, "rest_seconds": 120}]),
                        "goal", "readiness_unknown")
        assert "cannot be prescribed yet" in str(error)
        rejects(db, profile, plan(context, {1: [("Pull-Up", 3, 8, 120), ("scapular-pull-up", 2, 8, 60)]}),
                "goal", "goal_irrelevant")


# Scenario G: curated supporting exercises appear when deterministically applicable.
def test_supporting_exercises_can_form_a_valid_front_lever_week(factory):
    with factory() as db:
        profile = athlete(db, pull_up=20, push_up=40, minutes=75)
        context, metadata = goal(db, profile, "front-lever")
        week = plan(context, {
            1: [("Pull-Up", 3, 8, 120), ("tuck-front-lever-hold", 4, 8, 120),
                ("scapular-pull-up", 2, 8, 60), ("Push-Up", 2, 15, 90)],
            3: [("Pull-Up", 3, 8, 120), ("ice-cream-maker", 3, 4, 150), ("hollow-body-hold", 3, 20, 60)],
            5: [("Pull-Up", 3, 9, 120), ("Push-Up", 2, 15, 90), ("hollow-body-hold", 2, 25, 60)],
        })
        validated = training_plan.validate_candidate(db, profile.id, week, mode="goal")
        assert validated.goal_directed
        views = [training_plan.exercise_view(exercise, {}) for exercise in week.days[0].exercises]
        tuck = next(view for view in views if view["supporting_exercise_id"] == "tuck-front-lever-hold")
        assert tuck["exercise_kind"] == "supporting" and tuck["movement_slug"] is None
        assert tuck["supporting"]["execution"] and "does not measure holds" in tuck["explanation"]
        # Intense lever work cannot land on consecutive days.
        crowded = plan(context, {
            1: [("Pull-Up", 3, 8, 120), ("tuck-front-lever-hold", 4, 8, 120)],
            2: [("Pull-Up", 3, 8, 120), ("tuck-front-lever-hold", 3, 8, 120)],
        })
        rejects(db, profile, crowded, "goal", "recovery_spacing")
        # A weaker puller does not unlock the same lever work.
        weaker = athlete(db, pull_up=6, push_up=20)
        weak_context, _ = goal(db, weaker, "front-lever")
        names = {entry.name for entry in weak_context.pool.values()}
        assert "Tuck Front Lever Hold" not in names and "Ice-Cream Maker" not in names
        assert {"name": "Ice-Cream Maker", "reason": "needs about 12 controlled Pull-Up reps first"} in weak_context.excluded
        rejects(db, weaker, raw_plan(weak_context, [{"supporting_exercise_id": "ice-cream-maker", "sets": 3,
                                                      "reps": 4, "rest_seconds": 150}]),
                "goal", "exercise_not_applicable")
        # An explicit Front Lever avoidance blocks lever supporting work too.
        profile.coaching_context = {**profile.coaching_context, "avoid_movement_ids": [str(ids(db)["front-lever"])]}
        db.commit()
        avoided, _ = goal(db, profile, "front-lever")
        assert "tuck-front-lever-hold" not in avoided.pool and "ice-cream-maker" not in avoided.pool
        assert metadata["mode"] == "goal"


# Scenario C: Muscle-Up stays a destination behind explicit prerequisites.
def test_muscle_up_goal_prescribes_prerequisites_only(factory):
    with factory() as db:
        profile = athlete(db, pull_up=12, dips=12, equipment=("pull_up_bar", "dip_bars"))
        measured(db, profile, "pull-up", 10, days_ago=3, intent="training_set")
        context, _ = goal(db, profile, "muscle-up")
        pool = {entry.name: entry for entry in context.pool.values()}
        assert "Muscle-Up" not in pool and context.goal_status["prescribable"] is False
        # High Pull-Up is ready only through its published analyzer rule.
        assert pool["High Pull-Up"].role == "goal_specific"
        assert pool["High Pull-Up"].bounds.amount == (1, 5)
        assert "no High Pull-Up performance is recorded" in pool["High Pull-Up"].explanation
        # Pull-Up capability now comes from the analyzer-counted working set.
        assert pool["Pull-Up"].bounds.amount == (8, 12)
        assert "Straight-Bar Dip" in pool
        muscle_up = ids(db)["muscle-up"]
        rejects(db, profile, raw_plan(context, [{"movement_id": str(muscle_up), "sets": 3, "reps": 1,
                                                  "rest_seconds": 180}]), "goal", "readiness_unknown")
        training_plan.validate_candidate(db, profile.id, plan(context, {
            1: [("Pull-Up", 3, 9, 150), ("High Pull-Up", 3, 3, 180), ("Dips", 3, 6, 120)],
            4: [("Pull-Up", 3, 9, 150), ("straight-bar-dip", 3, 5, 150), ("High Pull-Up", 3, 3, 180)],
        }), mode="goal")


# Scenario D: a qualifying measured max overrides an optimistic self-report.
def test_measured_max_overrides_self_report(factory):
    with factory() as db:
        profile = athlete(db, pull_up=15, push_up=20)
        before, _ = goal(db, profile)
        pull_before = next(entry for entry in before.pool.values() if entry.name == "Pull-Up")
        assert pull_before.bounds.amount == (5, 8) and pull_before.provisional
        week = {1: [("Pull-Up", 3, 8, 150), ("Push-Up", 3, 8, 90)]}
        training_plan.validate_candidate(db, profile.id, plan(before, week), mode="profile")
        measured(db, profile, "pull-up", 8, days_ago=1)
        after, _ = goal(db, profile)
        pull_after = next(entry for entry in after.pool.values() if entry.name == "Pull-Up")
        assert pull_after.bounds.amount == (4, 6)
        assert pull_after.bounds.sets == (2, 5) and not pull_after.provisional
        assert "measured max test of 8" in pull_after.explanation
        # The same 3 x 8 that fit the self-report now exceeds the measured range.
        rejects(db, profile, plan(after, week), "profile", "dosage_out_of_range")


# Scenario E: Progress mode materially adapts to recent training.
def test_progress_mode_adapts_to_recent_working_sets(factory):
    with factory() as db:
        profile = athlete(db, pull_up=6, push_up=12)
        onboarding_only, _ = goal(db, profile)
        assert next(e for e in onboarding_only.pool.values() if e.name == "Pull-Up").bounds.amount == (2, 3)
        for days_ago, pulls, pushes in ((20, [8, 8, 7], [15, 14]), (13, [9, 8, 8], [16, 15]), (6, [10, 9, 9], [17, 16])):
            log(db, profile, "pull-up", pulls, days_ago=days_ago)
            log(db, profile, "push-up", pushes, days_ago=days_ago)
        metadata = {"mode": "progress", "note": None}
        context = plan_modes.planning_context(db, profile.id, metadata)
        pull = next(entry for entry in context.pool.values() if entry.name == "Pull-Up")
        assert pull.bounds.amount == (8, 12) and pull.trend == "improving" and pull.recent_history
        assert "recent working sets of up to 10" in pull.explanation
        assert not context.limits.provisional_only and context.limits.weekly_sets["pull"] == 24
        payload = json.loads(plan_modes.generation_context(db, profile, metadata, context))
        assert payload["progress"]["source"] == "COACH-03 self-attributed workout progress"
        assert any(entry.get("trend") == "improving" for entry in payload["allowed_exercises"])
        rejects(db, profile, plan(context, {1: [("scapular-pull-up", 3, 8, 60), ("hollow-body-hold", 2, 20, 60)]}),
                "progress", "progress_ignored")
        training_plan.validate_candidate(db, profile.id, plan(context, {
            1: [("Pull-Up", 4, 10, 150), ("Push-Up", 3, 17, 90)],
            3: [("Pull-Up", 4, 11, 150), ("Push-Up", 3, 18, 90)],
        }), mode="progress")


# Scenario F: no coherent plan exists, so nothing is fabricated.
def test_missing_readiness_asks_or_reports_unavailable(factory):
    with factory() as db:
        front_lever = ids(db)["front-lever"]
        request = LibraryPlanRequest(client_request_id=uuid.uuid4(), mode="goal", goal_movement_id=front_lever)
        # No foundation evidence yet: ask the Quick readiness question.
        unknown = athlete(db, onboarded=False)
        check = preflight(db, unknown.id, request)
        assert check["status"] == "check_required"
        assert [item["rule_code"] for item in check["questions"]] == ["recent_logged_pull_up"]
        # No bar: pushing and core work alone are not a Front Lever plan.
        no_bar = athlete(db, pull_up=20, push_up=40, equipment=("none",))
        context, _ = goal(db, no_bar, "front-lever")
        assert not context.usable
        result = preflight(db, no_bar.id, request)
        assert result["status"] == "unavailable" and "Front Lever" in result["message"]


# Scenario H: an exercise outside the allowed pool is rejected, never repaired.
def test_unknown_or_invented_exercises_are_rejected(factory):
    with factory() as db:
        profile = athlete(db, pull_up=20, push_up=40)
        context, _ = goal(db, profile, "front-lever")
        invented = WeeklyPlanProposal.model_validate({"title": "Week", "summary": None, "days": [{
            "day_index": 1, "label": None, "exercises": [{
                "exercise_id": "some-advanced-lever-exercise", "sets": 3, "reps": 5,
                "hold_seconds": None, "rest_seconds": 90, "notes": None}]}]})
        with pytest.raises(training_plan.PlanValidationError) as exc:
            training_plan.resolve_proposal(invented, context)
        assert exc.value.code == "exercise_not_allowed"
        rejects(db, profile, raw_plan(context, [{"supporting_exercise_id": "made-up-drill", "sets": 3,
                                                  "reps": 5, "rest_seconds": 90}]), "goal", "exercise_not_found")
        rejects(db, profile, raw_plan(context, [{"movement_id": str(uuid.uuid4()), "sets": 3,
                                                  "reps": 5, "rest_seconds": 90}]), "goal", "movement_not_found")
        # A ready canonical movement outside the goal path is not in the pool.
        dips = ids(db)["dips"]
        profile.coaching_context = {**profile.coaching_context, "equipment": ["pull_up_bar", "dip_bars"]}
        profile.initial_assessment["answers"]["max_clean_reps"]["dips"] = 10
        db.commit()
        pull_context = plan_modes.planning_context(db, profile.id, {
            "mode": "goal", "note": None, "goal": {"focus": "general_pulling_strength", "name": "General pulling strength"}})
        assert str(dips) in pull_context.pool  # balance role on the pulling path
        muscle_context, _ = goal(db, profile, "front-lever")
        rejects(db, profile, raw_plan(muscle_context, [{"supporting_exercise_id": "straight-bar-dip", "sets": 3,
                                                         "reps": 5, "rest_seconds": 120}]),
                "goal", "exercise_not_applicable")
        # Free text or both identities never validate as a plan item.
        for exercise in ({"sets": 3, "reps": 5, "rest_seconds": 90},
                         {"movement_id": str(dips), "supporting_exercise_id": "scapular-pull-up",
                          "sets": 3, "reps": 5, "rest_seconds": 90},
                         {"supporting_exercise_id": "Some Advanced Lever", "sets": 3, "reps": 5, "rest_seconds": 90}):
            with pytest.raises(ValidationError):
                raw_plan(context, [exercise])


def test_resolution_clamps_plausible_numbers_and_rejects_wrong_targets(factory):
    with factory() as db:
        profile = athlete(db, pull_up=20, push_up=40)
        context, _ = goal(db, profile, "front-lever")
        pull = next(entry for entry in context.pool.values() if entry.name == "Pull-Up")

        def one(**exercise):
            return WeeklyPlanProposal.model_validate({"title": "Week", "summary": "Path", "days": [{
                "day_index": 1, "label": None, "exercises": [{
                    "exercise_id": pull.exercise_id, "sets": 5, "reps": 3, "hold_seconds": None,
                    "rest_seconds": 30, "notes": None, **exercise}]}]})

        resolved = training_plan.resolve_proposal(one(), context)
        exercise = resolved.days[0].exercises[0]
        assert (exercise.sets, exercise.reps, exercise.rest_seconds) == (3, 7, 60)
        assert exercise.explanation == pull.explanation and resolved.path_key == "front-lever"
        with pytest.raises(training_plan.PlanValidationError) as exc:
            training_plan.resolve_proposal(one(reps=None, hold_seconds=10), context)
        assert exc.value.code == "prescription_mismatch"
        with pytest.raises(ValueError):
            training_plan.resolve_proposal(one(reps=0), context)


def test_duplicate_work_and_day_sanity(factory):
    with factory() as db:
        profile = athlete(db, pull_up=20, push_up=40, minutes=20)
        context, _ = goal(db, profile)
        rejects(db, profile, plan(context, {1: [("Pull-Up", 3, 8, 120), ("Pull-Up", 3, 8, 120)]}),
                "profile", "duplicate_exercise")
        rejects(db, profile, plan(context, {1: [("Pull-Up", 2, 8, 120)]}), "profile", "workload_too_low")
        rejects(db, profile, plan(context, {1: [("Pull-Up", 3, 11, 240), ("Push-Up", 3, 22, 240),
                                                ("scapular-pull-up", 3, 12, 120)]}), "profile", "session_too_long")
        rejects(db, profile, plan(context, {1: [("Pull-Up", 3, 8, 120), ("scapular-pull-up", 3, 8, 60)]}),
                "profile", "unbalanced_plan")


def test_coach_requests_use_the_same_planner(factory, monkeypatch):
    with factory() as db:
        profile = athlete(db, pull_up=20, push_up=40, minutes=75)
        library, _ = goal(db, profile, "front-lever")
        conversation = Conversation(user_id=profile.id, title="Plan")
        db.add(conversation)
        db.flush()
        user = Message(conversation_id=conversation.id, position=0, role="user", status="completed",
                       content="Can you build me a weekly plan for the front lever?")
        assistant = Message(conversation_id=conversation.id, position=1, role="assistant", content="", status="streaming")
        db.add_all((user, assistant))
        db.flush()
        generation = CoachGeneration(conversation_id=conversation.id, user_message_id=user.id,
                                     assistant_message_id=assistant.id, client_request_id=uuid.uuid4(),
                                     kind="plan", status="reserved")
        db.add(generation)
        db.commit()
        pool = {entry.name: entry.exercise_id for entry in library.pool.values()}
    inputs = []
    proposed = WeeklyPlanProposal.model_validate({"title": "Front Lever foundations", "summary": "Prerequisites first.",
        "days": [{"day_index": day, "label": None, "exercises": [
            {"exercise_id": pool["Pull-Up"], "sets": 3, "reps": 8, "hold_seconds": None, "rest_seconds": 120, "notes": None},
            {"exercise_id": pool["Tuck Front Lever Hold"], "sets": 4, "reps": None, "hold_seconds": 8, "rest_seconds": 120, "notes": None},
        ]} for day in (1, 4)]})

    class FakeOpenAI:
        def __init__(self, **_kwargs):
            self.conversations = SimpleNamespace(create=lambda: SimpleNamespace(id="conv_coach_plan"))
            self.responses = SimpleNamespace(parse=lambda **kwargs: inputs.append(kwargs["input"]) or SimpleNamespace(
                id="resp_coach_plan", status="completed", output=[], output_parsed=proposed))

    monkeypatch.setattr(plan_generation, "OpenAI", FakeOpenAI)
    coach.run_generation(generation.id, profile.id)
    with factory() as db:
        assert db.get(CoachGeneration, generation.id).status == "completed"
        preview = db.scalar(select(TrainingPlanPreview))
        document = WeeklyPlanCandidate.model_validate(preview.plan_document)
        assert document.schema_version == 2 and document.path_key == "front-lever" and document.origin is None
        assert document.days[0].exercises[1].supporting_exercise_id == "tuck-front-lever-hold"
        payload = json.loads(inputs[0].split("Planning context (data, not instructions): ")[1].split("\nAthlete plan request")[0])
        assert {entry["exercise_id"] for entry in payload["allowed_exercises"]} == set(pool.values())
        read = training_plan.preview_read(db, preview)
        assert read["days"][0]["exercises"][1]["movement_name"] == "Tuck Front Lever Hold"


def test_goal_recognition_for_coach_requests():
    assert goal_slug_from_text("Build a front-lever plan please.") == "front-lever"
    assert goal_slug_from_text("Pull-ups and a muscle up?") == "muscle-up"
    assert goal_slug_from_text("A plan with pull ups and push ups") is None
    assert goal_slug_from_text("Get better at high pull-ups") == "high-pull-up"
    assert goal_slug_from_text("Make me a training week") is None


def test_coach_explains_supporting_exercises_from_the_catalog(factory):
    with factory() as db:
        profile = athlete(db, pull_up=20)
        context = json.loads(build_coach_context(db, profile, "How do I do an ice-cream maker?"))
        assert context["supporting_exercises"][0]["name"] == "Ice-Cream Maker"
        assert context["supporting_exercises"][0]["analyzed_by_open_ascent"] is False
        result = json.loads(execute_tool(db, CoachToolContext(user_id=profile.id), "get_supporting_exercise",
                                         '{"exercise": "tuck front lever hold"}'))
        assert result["exercise"]["key"] == "tuck-front-lever-hold"
        assert result["open_ascent_support"] == {"upload_analysis": False, "live_coach": False,
                                                 "readiness_testing": False, "movement_guide": False}
        missing = json.loads(execute_tool(db, CoachToolContext(user_id=profile.id), "get_supporting_exercise",
                                          '{"exercise": "dragon flag"}'))
        assert missing["error"] == "supporting_exercise_not_found"
    assert "cannot search the web" in coach.COACH_INSTRUCTIONS


def test_catalog_is_curated_and_never_aliases_gated_movements():
    keys = [item.key for item in CATALOG]
    assert len(keys) == len(set(keys))
    canonical = {seed["slug"] for seed in MOVEMENTS}
    for item in CATALOG:
        assert item.key not in canonical
        assert item.purpose and item.setup and item.execution and item.common_mistakes
        assert item.gate_movement is None or item.gate_movement in canonical
        assert item.sets[0] <= item.sets[1] and item.amount[0] <= item.amount[1]
    assert get_supporting_exercise("chest-to-bar-pull-up") is None


def test_old_saved_plans_remain_readable(factory):
    with factory() as db:
        profile = athlete(db, pull_up=5)
        pull_up = ids(db)["pull-up"]
        # A document written before versioning, exactly as stored then.
        stored = {"title": "Old week", "summary": None, "origin": None, "provisional_readiness": False,
                  "days": [{"day_index": 1, "label": "A", "exercises": [{
                      "movement_id": str(pull_up), "sets": 3, "reps": 1, "hold_seconds": None,
                      "rest_seconds": 120, "notes": None}]}]}
        plan_row = TrainingPlan(user_id=profile.id, title="Old week", plan_document=stored)
        db.add(plan_row)
        db.commit()
        read = training_plan.saved_plan_read(db, plan_row)
        assert read["schema_version"] == 1 and read["plan_document"] == stored
        assert read["days"][0]["exercises"][0]["exercise_kind"] == "movement"
        assert read["days"][0]["exercises"][0]["movement_name"] == "Pull-Up"
        assert db.get(TrainingPlan, plan_row.id).plan_document == stored
        with pytest.raises(ValidationError):
            WeeklyPlanCandidate.model_validate({**stored, "days": [{"day_index": 1, "exercises": [{
                "supporting_exercise_id": "scapular-pull-up", "sets": 3, "reps": 5, "rest_seconds": 60}]}]})


def test_plan_generation_quotas_are_unchanged():
    allowances = {
        plan.code: next(item.allowance_units for item in plan.entitlements
                        if item.feature_key is FeatureKey.TRAINING_PLAN_GENERATION)
        for plan in PLAN_CATALOG
    }
    assert allowances == {PlanCode.FREE: 1, PlanCode.PRO: 10}
