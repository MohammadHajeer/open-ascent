"""Offline COACH-05 authorization, bounds, and Responses loop coverage."""

from __future__ import annotations

import json
import uuid
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

import pytest
from sqlalchemy import create_engine, event
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.models.analysis import Analysis
from app.models.coach import CoachGeneration, Conversation, Message
from app.models.movement import Movement
from app.models.movement_documentation import MovementDocumentation
from app.models.profile import Profile
from app.models.training import WorkoutSession, WorkoutSet
from app.schemas.coach_tools import (
    RecentAnalysesArguments,
    RecentWorkoutsArguments,
    SearchMovementsArguments,
)
from app.services import coach
from app.services.coach_tools import (
    TOOL_REGISTRY,
    CoachToolContext,
    execute_tool,
    openai_tools,
)


@compiles(JSONB, "sqlite")
def _jsonb_sqlite(_type, _compiler, **_kwargs):
    return "JSON"


@pytest.fixture
def storage(monkeypatch):
    engine = create_engine(
        "sqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False}
    )

    @event.listens_for(engine, "connect")
    def functions(connection, _record):
        connection.create_function("gen_random_uuid", 0, lambda: uuid.uuid4().hex)
        connection.create_function("now", 0, lambda: datetime.now(UTC).isoformat())

    tables = [
        Profile.__table__,
        Movement.__table__,
        MovementDocumentation.__table__,
        Analysis.__table__,
        WorkoutSession.__table__,
        WorkoutSet.__table__,
        Conversation.__table__,
        Message.__table__,
        CoachGeneration.__table__,
    ]
    json_defaults = [
        (column, column.server_default)
        for table in tables
        for column in table.columns
        if isinstance(column.type, JSONB)
    ]
    for column, _ in json_defaults:
        column.server_default = None
    partial_indexes = [
        (table, index)
        for table in tables
        for index in list(table.indexes)
        if index.dialect_options["postgresql"].get("where") is not None
    ]
    for table, index in partial_indexes:
        table.indexes.remove(index)
    try:
        for table in tables:
            table.create(engine)
    finally:
        for column, default in json_defaults:
            column.server_default = default
        for table, index in partial_indexes:
            table.indexes.add(index)
    factory = sessionmaker(engine, expire_on_commit=False)
    monkeypatch.setattr(coach, "SessionLocal", factory)
    monkeypatch.setattr(coach, "reserve_usage", lambda *_a, **_kw: None)
    yield factory
    engine.dispose()


def _profile(db, *, user_id=None):
    value = Profile(
        id=user_id or uuid.uuid4(),
        display_name="Athlete",
        app_role="athlete",
        coaching_context={"primary_goal": "strength", "equipment": ["rings"]},
        initial_assessment={
            "submitted_at": "2026-01-01",
            "answers": {
                "training_experience": "some",
                "max_clean_reps": {"pull_up": 5},
                "dimension_stage": {"pulling": "building"},
            },
        },
        athlete_state={
            "overall_level": "developing",
            "overall_source": "self_reported",
            "dimensions": {
                "pulling": {
                    "level": "developing",
                    "source": "self_reported",
                    "confidence": "provisional",
                }
            },
        },
        stripe_customer_id=f"private-{uuid.uuid4()}",
    )
    db.add(value)
    db.flush()
    return value


def _movement(db, name="Pull-Up", slug="pull-up"):
    movement = Movement(
        name=name,
        slug=slug,
        family_key="vertical_pull",
        upload_analysis_supported=True,
        live_coach_supported=False,
    )
    db.add(movement)
    db.flush()
    return movement


def _analysis(db, movement, owner, kind="authenticated", result=None):
    now = datetime.now(UTC)
    doc = MovementDocumentation(
        movement_id=movement.id,
        version=1 + db.query(MovementDocumentation).count(),
        status="archived",
        content={"notice": "Old"},
    )
    db.add(doc)
    db.flush()
    item = Analysis(
        user_id=owner.id if owner else None,
        movement_id=movement.id,
        safety_documentation_id=doc.id,
        safety_ack_version="v1",
        safety_acknowledged_at=now,
        owner_kind=kind,
        status="completed",
        stage="completed",
        completed_at=now,
        reservation_operation_key=str(uuid.uuid4()),
        request_fingerprint=uuid.uuid4().hex,
        reservation_expires_at=now + timedelta(minutes=10),
        progress_snapshot={},
        guest_token_hash="hash" if kind == "guest" else None,
        guest_rate_key="rate" if kind == "guest" else None,
        access_expires_at=now + timedelta(days=1) if kind == "guest" else None,
        purge_after=now + timedelta(days=1) if kind == "guest" else None,
        result=result,
        valid_rep_count=1,
    )
    db.add(item)
    db.flush()
    return item


def _call(db, owner, name, **arguments):
    return json.loads(
        execute_tool(db, CoachToolContext(owner.id), name, json.dumps(arguments))
    )


def test_registry_and_argument_validation(storage):
    expected = {
        "get_athlete_profile_context",
        "get_recent_workouts",
        "get_progress_summary",
        "get_recent_analyses",
        "get_analysis_detail",
        "get_movement_guide",
        "get_supporting_exercise",
        "search_movements",
    }
    assert set(TOOL_REGISTRY) == expected
    assert {item["name"] for item in openai_tools()} == expected
    assert all(
        "user_id" not in item["parameters"].get("properties", {})
        for item in openai_tools()
    )
    assert RecentWorkoutsArguments().limit == 5
    assert RecentAnalysesArguments().limit == 5
    assert SearchMovementsArguments(query=" pull ").query == "pull"
    with storage() as db:
        owner = _profile(db)
        assert _call(db, owner, "unknown_tool") == {"error": "unknown_tool"}
        assert _call(
            db, owner, "search_movements", query="pull", user_id=str(uuid.uuid4())
        ) == {"error": "invalid_arguments"}
        assert _call(
            db, owner, "get_athlete_profile_context", user_id=str(uuid.uuid4())
        ) == {"error": "invalid_arguments"}
        assert _call(db, owner, "get_analysis_detail", analysis_id="bad") == {
            "error": "invalid_arguments"
        }
        assert json.loads(
            execute_tool(db, CoachToolContext(owner.id), "search_movements", "not json")
        ) == {"error": "invalid_arguments"}
        assert json.loads(
            execute_tool(db, CoachToolContext(owner.id), "search_movements", "x" * 2049)
        ) == {"error": "invalid_arguments"}
        for limit in (-1, 0, 11, True):
            assert _call(db, owner, "search_movements", query="pull", limit=limit) == {
                "error": "invalid_arguments"
            }
        assert _call(db, owner, "search_movements", query="x" * 81) == {
            "error": "invalid_arguments"
        }
        assert _call(db, owner, "search_movements", query="pull", limit=10) == {
            "movements": []
        }
        assert _call(db, owner, "get_recent_workouts", movement="  ") == {
            "error": "invalid_arguments"
        }
        owner.coaching_context = {"primary_goal": "x" * 20000}
        db.commit()
        assert _call(db, owner, "get_athlete_profile_context") == {
            "error": "result_too_large"
        }


def test_profile_workouts_progress_and_movement_search(storage, monkeypatch):
    # SQLite drops timezone data; production PostgreSQL preserves it.
    from app.services import progress as progress_service

    monkeypatch.setattr(
        progress_service,
        "_current_week_start",
        lambda _now: datetime.now(UTC).replace(tzinfo=None) - timedelta(days=7),
    )
    with storage() as db:
        owner, other = _profile(db), _profile(db)
        empty = _profile(db)
        movement = _movement(db)
        now = datetime.now(UTC)
        for user, performer, reps in (
            (owner, "self", 5),
            (owner, "other", 99),
            (other, "self", 77),
        ):
            session = WorkoutSession(
                user_id=user.id, source="manual", started_at=now, completed_at=now
            )
            db.add(session)
            db.flush()
            db.add(
                WorkoutSet(
                    session_id=session.id,
                    movement_id=movement.id,
                    position=0,
                    source="manual",
                    performer=performer,
                    intent="training_set",
                    reps=reps,
                )
            )
        db.commit()
        profile = _call(db, owner, "get_athlete_profile_context")
        assert (
            profile["athlete_state"]["dimensions"]["pulling"]["confidence"]
            == "provisional"
        )
        assert "stripe_customer_id" not in json.dumps(profile)
        assert "private" not in json.dumps(profile)
        workouts = _call(db, owner, "get_recent_workouts", movement="pull-up")
        assert [
            item["reps"] for session in workouts["sessions"] for item in session["sets"]
        ] == [5]
        assert workouts["sessions"][0]["sets"][0]["performer"] == "self"
        assert _call(db, owner, "get_recent_workouts", movement="front-lever") == {
            "error": "movement_not_found"
        }
        progress = _call(db, owner, "get_progress_summary", movement="pull-up")
        assert progress["movements"][0]["metrics"][0]["points"][0]["value"] == 5
        assert "score" not in json.dumps(progress)
        assert (
            _call(db, owner, "search_movements", query="pullups")["movements"][0][
                "slug"
            ]
            == "pull-up"
        )
        assert (
            _call(db, other, "get_recent_workouts")["sessions"][0]["sets"][0]["reps"]
            == 77
        )
        assert _call(db, empty, "get_recent_workouts")["sessions"] == []
        assert _call(db, empty, "get_progress_summary")["movements"] == []
        for index in range(11):
            session = WorkoutSession(
                user_id=owner.id,
                source="self_reported",
                started_at=now - timedelta(days=index + 1),
                completed_at=now - timedelta(days=index + 1),
            )
            db.add(session)
            db.flush()
            db.add(
                WorkoutSet(
                    session_id=session.id,
                    movement_id=movement.id,
                    position=0,
                    source="self_reported",
                    performer="self",
                    intent="assessment",
                    reps=index + 1,
                )
            )
        db.commit()
        assert len(_call(db, owner, "get_recent_workouts")["sessions"]) == 5
        assert len(_call(db, owner, "get_recent_workouts", limit=10)["sessions"]) == 10
        for index in range(12):
            _movement(db, f"Pull Variant {index}", f"pull-variant-{index}")
        db.commit()
        assert (
            len(
                _call(db, owner, "search_movements", query="pull", limit=10)[
                    "movements"
                ]
            )
            == 10
        )
        assert len(_call(db, owner, "search_movements", query="pull")["movements"]) == 5


def test_analyses_are_owned_guest_excluded_and_details_bounded(storage):
    with storage() as db:
        owner, other = _profile(db), _profile(db)
        movement = _movement(db)
        result = {
            "outcome": "completed",
            "reps": [
                {
                    "rep_index": index,
                    "outcome": "valid",
                    "technique_findings": ["Keep control"],
                    "reason_codes": [],
                    "form_quality": {
                        "bottom_extension": "acceptable",
                        "raw_frames": ["hidden"],
                    },
                    "tempo": {"descent_ms": 750, "raw_trace": ["hidden"]},
                }
                for index in range(30)
            ],
            "evidence": {"usable_pose_ratio": 0.9, "reason_codes": []},
            "video_path": "private/path",
        }
        own = _analysis(db, movement, owner, result=result)
        foreign = _analysis(db, movement, other, result=result)
        guest = _analysis(db, movement, None, kind="guest", result=result)
        db.commit()
        recent = _call(db, owner, "get_recent_analyses", movement="pull-up")
        assert [item["analysis_id"] for item in recent["analyses"]] == [str(own.id)]
        assert len(_call(db, owner, "get_recent_analyses", limit=1)["analyses"]) == 1
        detail = _call(db, owner, "get_analysis_detail", analysis_id=str(own.id))
        assert len(detail["rep_details"]) == 12
        assert detail["rep_details_truncated"] is True
        assert detail["rep_details"][0]["form_quality"] == {
            "bottom_extension": "acceptable"
        }
        assert detail["rep_details"][0]["tempo"] == {"descent_ms": 750}
        assert "video_path" not in json.dumps(detail)
        assert "private/path" not in json.dumps(detail)
        for item in (foreign, guest):
            assert _call(
                db, owner, "get_analysis_detail", analysis_id=str(item.id)
            ) == {"error": "analysis_not_found"}


def test_guide_only_published_without_entitlement(storage):
    with storage() as db:
        owner = _profile(db)
        movement = _movement(db)
        archived = MovementDocumentation(
            movement_id=movement.id,
            version=1,
            status="archived",
            content={"notice": "Old"},
        )
        draft = MovementDocumentation(
            movement_id=movement.id,
            version=2,
            status="draft",
            content={"notice": "Secret draft"},
        )
        db.add_all([archived, draft])
        db.commit()
        assert _call(db, owner, "get_movement_guide", movement="pull-up") == {
            "error": "movement_guide_not_found"
        }
        published = MovementDocumentation(
            movement_id=movement.id,
            version=3,
            status="published",
            published_at=datetime.now(UTC),
            content={
                "notice": "Use a stable bar",
                "prerequisites": ["Comfortable hang"],
                "stop_conditions": ["Stop with pain"],
                "easier_option": "Assisted pull-up",
            },
        )
        db.add(published)
        db.commit()
        guide = _call(db, owner, "get_movement_guide", movement="pull-up")
        assert guide["safety"]["stop_conditions"] == ["Stop with pain"]
        assert guide["safety"]["prerequisites"] == ["Comfortable hang"]
        assert "Secret draft" not in json.dumps(guide)


def test_streamed_tool_round_trip_and_limits(storage, monkeypatch):
    requests = []

    class FakeClient:
        def __init__(self, **_kwargs):
            self.conversations = SimpleNamespace(
                create=lambda: SimpleNamespace(id="conv_tools")
            )
            self.responses = SimpleNamespace(create=self.create)

        def create(self, **kwargs):
            requests.append(kwargs)
            number = len(requests)
            if number == 1:
                response = SimpleNamespace(
                    id="resp_1",
                    output_text="",
                    output=[
                        SimpleNamespace(
                            type="function_call",
                            call_id="call_1",
                            name="get_athlete_profile_context",
                            arguments="{}",
                        )
                    ],
                )
            else:
                response = SimpleNamespace(
                    id=f"resp_{number}", output_text="Your goal is strength.", output=[]
                )
            events = [SimpleNamespace(type="response.created", response=response)]
            if number > 1:
                events.append(
                    SimpleNamespace(
                        type="response.output_text.delta",
                        delta="Your goal is strength.",
                    )
                )
            events.append(SimpleNamespace(type="response.completed", response=response))
            return iter(events)

    monkeypatch.setattr(coach, "OpenAI", FakeClient)
    with storage() as db:
        owner = _profile(db)
        conversation = Conversation(user_id=owner.id, title="New chat")
        db.add(conversation)
        db.commit()
        generation, _ = coach.reserve_generation(
            db, owner, conversation.id, uuid.uuid4(), "How is my training?"
        )
        coach.run_generation(generation.id, owner.id)
        db.refresh(generation)
        assert generation.status == "completed"
        assert (
            db.get(Message, generation.assistant_message_id).content
            == "Your goal is strength."
        )
        assert requests[0]["stream"] is True and requests[1]["stream"] is True
        assert requests[1]["conversation"] == "conv_tools"
        assert requests[1]["input"][0]["type"] == "function_call_output"
        assert requests[1]["input"][0]["call_id"] == "call_1"
        assert (
            json.loads(requests[1]["input"][0]["output"])["athlete_reported_profile"][
                "primary_goal"
            ]
            == "strength"
        )


def test_tool_round_limit_fails_safely(storage, monkeypatch):
    counter = 0

    class FakeClient:
        def __init__(self, **_kwargs):
            self.conversations = SimpleNamespace(
                create=lambda: SimpleNamespace(id="conv_limit")
            )
            self.responses = SimpleNamespace(create=self.create)

        def create(self, **_kwargs):
            nonlocal counter
            counter += 1
            response = SimpleNamespace(
                id=f"resp_{counter}",
                output_text="",
                output=[
                    SimpleNamespace(
                        type="function_call",
                        call_id=f"call_{counter}",
                        name="search_movements",
                        arguments='{"query":"pull"}',
                    )
                ],
            )
            return iter(
                (
                    SimpleNamespace(type="response.created", response=response),
                    SimpleNamespace(type="response.completed", response=response),
                )
            )

    monkeypatch.setattr(coach, "OpenAI", FakeClient)
    with storage() as db:
        owner = _profile(db)
        conversation = Conversation(user_id=owner.id, title="New chat")
        db.add(conversation)
        db.commit()
        generation, _ = coach.reserve_generation(
            db, owner, conversation.id, uuid.uuid4(), "How are my pull-ups?"
        )
        coach.run_generation(generation.id, owner.id)
        db.refresh(generation)
        assert generation.status == "failed"
        assert generation.error_code == "tool_limit_exceeded"
        assert counter == 4


def test_multiple_tool_rounds_and_invalid_calls_continue_safely(storage, monkeypatch):
    requests = []

    class FakeClient:
        def __init__(self, **_kwargs):
            self.conversations = SimpleNamespace(
                create=lambda: SimpleNamespace(id="conv_multi")
            )
            self.responses = SimpleNamespace(create=self.create)

        def create(self, **kwargs):
            requests.append(kwargs)
            number = len(requests)
            if number == 1:
                calls = [
                    SimpleNamespace(
                        type="function_call",
                        call_id="a",
                        name="unknown_tool",
                        arguments="{}",
                    ),
                    SimpleNamespace(
                        type="function_call",
                        call_id="b",
                        name="get_recent_workouts",
                        arguments='{"user_id":"bad"}',
                    ),
                ]
            elif number == 2:
                calls = [
                    SimpleNamespace(
                        type="function_call",
                        call_id="c",
                        name="search_movements",
                        arguments='{"query":"pullups"}',
                    )
                ]
            else:
                calls = []
            response = SimpleNamespace(
                id=f"resp_multi_{number}", output_text="Ready.", output=calls
            )
            return iter(
                (
                    SimpleNamespace(type="response.created", response=response),
                    SimpleNamespace(type="response.completed", response=response),
                )
            )

    monkeypatch.setattr(coach, "OpenAI", FakeClient)
    with storage() as db:
        owner = _profile(db)
        _movement(db)
        conversation = Conversation(user_id=owner.id, title="New chat")
        db.add(conversation)
        db.commit()
        generation, _ = coach.reserve_generation(
            db, owner, conversation.id, uuid.uuid4(), "How are my pull-ups?"
        )
        coach.run_generation(generation.id, owner.id)
        db.refresh(generation)
        assert generation.status == "completed"
        assert len(requests) == 3
        assert json.loads(requests[1]["input"][0]["output"]) == {
            "error": "unknown_tool"
        }
        assert json.loads(requests[1]["input"][1]["output"]) == {
            "error": "invalid_arguments"
        }
        assert (
            json.loads(requests[2]["input"][0]["output"])["movements"][0]["slug"]
            == "pull-up"
        )


def test_total_call_limit_fails_safely(storage, monkeypatch):
    counter = 0

    class FakeClient:
        def __init__(self, **_kwargs):
            self.conversations = SimpleNamespace(
                create=lambda: SimpleNamespace(id="conv_calls")
            )
            self.responses = SimpleNamespace(create=self.create)

        def create(self, **_kwargs):
            nonlocal counter
            counter += 1
            amount = 4 if counter == 1 else 3
            response = SimpleNamespace(
                id=f"resp_calls_{counter}",
                output_text="",
                output=[
                    SimpleNamespace(
                        type="function_call",
                        call_id=f"call_{counter}_{index}",
                        name="search_movements",
                        arguments='{"query":"pull"}',
                    )
                    for index in range(amount)
                ],
            )
            return iter(
                (
                    SimpleNamespace(type="response.created", response=response),
                    SimpleNamespace(type="response.completed", response=response),
                )
            )

    monkeypatch.setattr(coach, "OpenAI", FakeClient)
    with storage() as db:
        owner = _profile(db)
        conversation = Conversation(user_id=owner.id, title="New chat")
        db.add(conversation)
        db.commit()
        generation, _ = coach.reserve_generation(
            db, owner, conversation.id, uuid.uuid4(), "How are my pull-ups?"
        )
        coach.run_generation(generation.id, owner.id)
        db.refresh(generation)
        assert generation.status == "failed"
        assert generation.error_code == "tool_limit_exceeded"
        assert counter == 2
