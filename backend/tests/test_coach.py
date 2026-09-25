"""Offline coverage of durable Coach state and provider event handling."""

from __future__ import annotations

import pathlib
import threading
import time
import uuid
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event, func, select
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

import app.api.coach as coach_api
from app.api.dependencies.auth import require_athlete
from app.db.database import get_db
from app.main import app
from app.models.coach import CoachGeneration, Conversation, Message
from app.models.movement import Movement
from app.models.profile import Profile
from app.models.training import (
    TrainingPlan,
    TrainingPlanPreview,
    WorkoutSession,
    WorkoutSet,
)
from app.services import coach
from app.services.coach_context import build_coach_context
from app.services.coach_live import live_hub
from app.services.feature_usage import FeatureAccessDeniedError


@compiles(JSONB, "sqlite")
def _jsonb_sqlite(_type, _compiler, **_kwargs):
    return "JSON"


@pytest.fixture
def session_factory(monkeypatch):
    engine = create_engine(
        "sqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False}
    )

    @event.listens_for(engine, "connect")
    def register_uuid(dbapi_connection, _record):
        dbapi_connection.create_function("gen_random_uuid", 0, lambda: uuid.uuid4().hex)
        dbapi_connection.create_function(
            "now", 0, lambda: datetime.now(UTC).isoformat()
        )

    json_defaults = [
        (column, column.server_default)
        for column in Profile.__table__.columns
        if isinstance(column.type, JSONB)
    ]
    for column, _default in json_defaults:
        column.server_default = None
    try:
        Profile.__table__.create(engine)
    finally:
        for column, default in json_defaults:
            column.server_default = default
    for table in (
        Conversation.__table__,
        Message.__table__,
        CoachGeneration.__table__,
        Movement.__table__,
        TrainingPlan.__table__,
        TrainingPlanPreview.__table__,
        WorkoutSession.__table__,
        WorkoutSet.__table__,
    ):
        table.create(engine)
    factory = sessionmaker(engine, expire_on_commit=False)
    monkeypatch.setattr(coach, "SessionLocal", factory)
    monkeypatch.setattr(coach, "reserve_usage", lambda *_args, **_kwargs: None)
    yield factory
    engine.dispose()


def _profile(db: Session, user_id: uuid.UUID | None = None) -> Profile:
    profile = Profile(
        id=user_id or uuid.uuid4(),
        display_name="Athlete",
        coaching_context={"primary_goal": "strength"},
        initial_assessment={},
        athlete_state={},
    )
    db.add(profile)
    db.commit()
    return profile


def test_conversations_owned_and_messages_are_idempotent(session_factory):
    with session_factory() as db:
        owner, stranger = _profile(db), _profile(db)
        first = Conversation(user_id=owner.id, title="New chat")
        second = Conversation(user_id=owner.id, title="New chat")
        db.add_all((first, second))
        db.commit()
        assert coach.owned_conversation(db, stranger.id, first.id) is None
        assert coach.owned_conversation(db, owner.id, first.id) is not None
        request_id = uuid.uuid4()
        generation, created = coach.reserve_generation(
            db, owner, first.id, request_id, "How do I improve Pull-Ups?"
        )
        assert created
        assert [m.role for m in coach.conversation_messages(db, first.id)] == [
            "user",
            "assistant",
        ]
        same, created = coach.reserve_generation(
            db, owner, first.id, request_id, "How do I improve Pull-Ups?"
        )
        assert not created and same.id == generation.id
        with pytest.raises(ValueError):
            coach.reserve_generation(
                db, owner, first.id, request_id, "Different question"
            )
        with pytest.raises(RuntimeError):
            coach.reserve_generation(db, owner, first.id, uuid.uuid4(), "Double submit")
        with pytest.raises(LookupError):
            coach.reserve_generation(
                db, stranger, first.id, uuid.uuid4(), "Unauthorized"
            )
        assert not coach.conversation_messages(db, second.id)


def test_first_send_creates_one_titled_conversation_and_retries_safely(session_factory):
    assert coach.derive_conversation_title(
        "How can I improve my false grip for muscle-ups?"
    ) == "Improving False Grip"
    with session_factory() as db:
        owner = _profile(db)
        request_id = uuid.uuid4()
        conversation, generation, created = coach.create_and_reserve_generation(
            db, owner, request_id, "How can I improve my false grip for muscle-ups?"
        )
        assert created
        assert conversation.title == "Improving False Grip"
        same_conversation, same_generation, created = (
            coach.create_and_reserve_generation(
                db, owner, request_id, "How can I improve my false grip for muscle-ups?"
            )
        )
        assert not created
        assert same_conversation.id == conversation.id
        assert same_generation.id == generation.id
        assert db.scalar(select(func.count(Conversation.id))) == 1
        assert db.scalar(select(func.count(Message.id))) == 2
        with pytest.raises(ValueError):
            coach.create_and_reserve_generation(db, owner, request_id, "Different")


IN_DOMAIN = (
    "I now can do a one leg frontlever for about 25secs is it good ?",
    "Is a 25-second one-leg Front Lever good?",
    "How do I improve my Pull-Ups?",
    "What is the difference between Pull-Up and Chin-Up?",
    "I want to achieve a Muscle-Up.",
    "How often should I train Front Lever?",
    "What does a false grip mean?",
    "How long should I hold an L-sit?",
    "Should I eat more protein on training days?",
)
CAPABILITY = ("Can Open Ascent analyze a Front Lever upload?",)
UNRELATED = (
    "Explain React Server Components.",
    "Who won the World Cup?",
    "What's the capital of Lebanon?",
)
AMBIGUOUS = ("so you can generate a plan for me ?", "dont be harsh", "What about that?")
CONVERSATIONAL = ("Hello", "Thanks, that helps", "Make it shorter", "Why?")


@pytest.mark.parametrize(
    "message", IN_DOMAIN + CAPABILITY + UNRELATED + AMBIGUOUS + CONVERSATIONAL
)
def test_scope_is_decided_by_the_single_coach_response(session_factory, message):
    """No local keyword gate: every non-safety message reaches one Luna request."""
    with session_factory() as db:
        owner = _profile(db)
        conversation, generation, created = coach.create_and_reserve_generation(
            db, owner, uuid.uuid4(), message
        )
        assert created and generation.status == "reserved"
        assistant = coach.conversation_messages(db, conversation.id)[-1]
        assert assistant.content == "" and assistant.status == "streaming"


def test_no_canned_scope_reply_remains():
    source = pathlib.Path(coach.__file__).read_text(encoding="utf-8")
    assert "Is this about how it relates" not in source
    assert "classify_coach_request" not in source
    assert not (pathlib.Path(coach.__file__).parent / "coach_domain.py").exists()


def test_coach_prompt_separates_domain_from_analyzer_support():
    instructions = coach.COACH_INSTRUCTIONS
    for guidance in (
        "Front Lever",
        "frontlever, FL",
        "Never ask whether an obviously training-related message is about training",
        "broader than Open Ascent's video analysis",
        "never what you can discuss",
        "answer honestly from that data",
        "Word it naturally for the conversation instead of repeating a stock sentence",
        "Do not answer, define, partly explain, or ask follow-up questions about the unrelated topic",
        "Ask a clarifying question only when you genuinely cannot tell",
        "Answer general questions directly without tools",
        "Call read-only tools only when the answer depends on personal records",
        "unrelated",
    ):
        assert guidance in instructions
    assert "silently classify" not in instructions


def test_coach_prompt_contract_for_tone_and_conversation():
    instructions = coach.COACH_INSTRUCTIONS
    for guidance in (
        "calm, supportive, confident, respectful, practical, and natural",
        "one main actionable focus",
        "never invent praise",
        "Respond naturally to greetings",
        "Do not turn every exchange into a formal assessment",
        "Keep genuine safety guidance direct and clear",
    ):
        assert guidance in instructions


def test_provider_stream_persists_both_turns_and_conversation_ids(
    session_factory, monkeypatch
):
    calls = []
    created_conversations = []

    class FakeClient:
        def __init__(self, **_kwargs):
            self.conversations = SimpleNamespace(create=self.create_conversation)
            self.responses = SimpleNamespace(create=self.create_response)

        def create_conversation(self):
            value = f"conv_{len(created_conversations) + 1}"
            created_conversations.append(value)
            return SimpleNamespace(id=value)

        def create_response(self, **kwargs):
            calls.append(kwargs)
            response = SimpleNamespace(
                id=f"resp_{len(calls)}", output_text="### Next session\n- Pull-Ups"
            )
            return iter(
                (
                    SimpleNamespace(type="response.created", response=response),
                    SimpleNamespace(
                        type="response.output_text.delta", delta="### Next session"
                    ),
                    SimpleNamespace(type="response.completed", response=response),
                )
            )

    monkeypatch.setattr(coach, "OpenAI", FakeClient)
    with session_factory() as db:
        owner = _profile(db)
        first = Conversation(user_id=owner.id, title="New chat")
        other = Conversation(user_id=owner.id, title="New chat")
        db.add_all((first, other))
        db.commit()
        for conversation, question in (
            (first, "How do I improve Pull-Ups?"),
            (first, "What next?"),
            (other, "What is false grip?"),
        ):
            generation, _ = coach.reserve_generation(
                db, owner, conversation.id, uuid.uuid4(), question
            )
            coach.run_generation(generation.id)
            db.expire_all()
            assert db.get(CoachGeneration, generation.id).status == "completed"
            assert db.get(Message, generation.assistant_message_id).content.startswith(
                "### Next session"
            )
            assert db.get(CoachGeneration, generation.id).provider_response_id
        assert len(created_conversations) == 2
        db.refresh(first)
        db.refresh(other)
        assert first.openai_conversation_id == "conv_1"
        assert other.openai_conversation_id == "conv_2"
        assert [call["conversation"] for call in calls] == [
            "conv_1",
            "conv_1",
            "conv_2",
        ]
        assert len(coach.conversation_messages(db, first.id)) == 4
        db.refresh(owner)
        assert owner.coaching_context == {"primary_goal": "strength"}
        assert owner.athlete_state == {}
        assert "primary_goal" in calls[0]["input"]
        assert "recent_self_logged_sets" not in calls[0]["input"]
        assert "unrelated" in calls[0]["instructions"]
        assert calls[0]["stream"] is True


def test_context_uses_self_sets_and_no_standalone_analysis(session_factory):
    with session_factory() as db:
        owner = _profile(db)
        movement = Movement(slug="pull-up", name="Pull-Up", family_key="vertical_pull")
        db.add(movement)
        db.flush()
        session = WorkoutSession(user_id=owner.id, source="manual")
        db.add(session)
        db.flush()
        db.add_all(
            (
                WorkoutSet(
                    session_id=session.id,
                    movement_id=movement.id,
                    position=0,
                    source="manual",
                    performer="self",
                    intent="training_set",
                    reps=6,
                ),
                WorkoutSet(
                    session_id=session.id,
                    movement_id=movement.id,
                    position=1,
                    source="manual",
                    performer="other",
                    intent="training_set",
                    reps=20,
                ),
            )
        )
        db.commit()
        owner.athlete_state = {
            "dimensions": {
                "pulling": {
                    "source": "self_reported",
                    "level": "developing",
                    "observed_at": "2026-01-01",
                }
            }
        }
        owner.initial_assessment = {"answers": {"max_clean_reps": {"pull_up": 8}}}
        db.commit()
        context = build_coach_context(db, owner, "Improve my Pull-Ups")
        assert '"reps":6' in context
        assert '"reps":20' not in context
        assert '"starting_self_reported_clean_rep_max"' in context
        assert '"provisional_self_reported_state"' in context
        assert "linked_analysis_findings" not in context
        assert "recent_self_logged_sets" not in build_coach_context(
            db, owner, "How do I handstand?"
        )
        assert '"reps":6' in build_coach_context(
            db, owner, "How has my training progressed?"
        )


def test_relevant_linked_analysis_findings_are_bounded_and_grounded():
    movement_id, analysis_id, user_id = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    movement = SimpleNamespace(id=movement_id, name="Pull-Up")
    workout_set = SimpleNamespace(
        movement_id=movement_id,
        analysis_id=analysis_id,
        reps=5,
        hold_seconds=None,
        intent="training_set",
    )
    analysis = SimpleNamespace(
        created_at=datetime.now(UTC),
        result={
            "reps": [{"rep_index": 4, "technique_findings": ["substantial_swing"]}]
        },
    )

    class FakeDb:
        def __init__(self):
            self.reads = 0

        def scalars(self, _statement):
            self.reads += 1
            return (
                [movement]
                if self.reads == 1
                else SimpleNamespace(all=lambda: [analysis])
            )

        def execute(self, _statement):
            return SimpleNamespace(all=lambda: [(workout_set, datetime.now(UTC))])

    profile = SimpleNamespace(
        id=user_id, coaching_context={}, initial_assessment={}, athlete_state={}
    )
    context = build_coach_context(
        FakeDb(), profile, "What did my Pull-Up analysis find?"
    )
    assert '"substantial_swing"' in context
    assert '"rep":4' in context
    assert str(analysis_id) not in context


def test_transport_interruption_never_reissues_a_paid_request(
    session_factory, monkeypatch
):
    attempts = []

    class BrokenClient:
        def __init__(self, **_kwargs):
            self.responses = SimpleNamespace(create=self.create_response)

        def create_response(self, **kwargs):
            attempts.append(kwargs)
            response = SimpleNamespace(id="resp_unknown")

            def events():
                yield SimpleNamespace(type="response.created", response=response)
                yield SimpleNamespace(
                    type="response.output_text.delta", delta="Partial answer"
                )
                raise ConnectionError("stream lost")

            return events()

    monkeypatch.setattr(coach, "OpenAI", BrokenClient)
    with session_factory() as db:
        owner = _profile(db)
        conversation = Conversation(
            user_id=owner.id, title="New chat", openai_conversation_id="conv_existing"
        )
        db.add(conversation)
        db.commit()
        request_id = uuid.uuid4()
        generation, _ = coach.reserve_generation(
            db, owner, conversation.id, request_id, "How do I pull up?"
        )
        coach.run_generation(generation.id)
        db.expire_all()
        assert db.get(CoachGeneration, generation.id).status == "interrupted"
        assert (
            db.get(Message, generation.assistant_message_id).content == "Partial answer"
        )
        same, created = coach.reserve_generation(
            db, owner, conversation.id, request_id, "How do I pull up?"
        )
        assert not created and same.id == generation.id
        assert len(attempts) == 1


def test_entitlement_denial_prevents_message_reservation(session_factory, monkeypatch):
    def deny(*_args, **_kwargs):
        raise FeatureAccessDeniedError("No Coach entitlement")

    monkeypatch.setattr(coach, "reserve_usage", deny)
    with session_factory() as db:
        owner = _profile(db)
        conversation = Conversation(user_id=owner.id, title="New chat")
        db.add(conversation)
        db.commit()
        with pytest.raises(FeatureAccessDeniedError):
            coach.reserve_generation(
                db, owner, conversation.id, uuid.uuid4(), "Teach me Pull-Ups"
            )
        assert coach.conversation_messages(db, conversation.id) == []
        safety, created = coach.reserve_generation(
            db,
            owner,
            conversation.id,
            uuid.uuid4(),
            "My shoulder hurts during Pull-Ups",
        )
        assert (
            created and safety.status == "completed" and safety.feature_usage_id is None
        )
        assert (
            "stop that movement" in db.get(Message, safety.assistant_message_id).content
        )


def test_preflight_failure_is_explicit_and_does_not_retry(session_factory, monkeypatch):
    calls = []

    class BrokenClient:
        def __init__(self, **_kwargs):
            self.conversations = SimpleNamespace(create=self.fail)

        def fail(self):
            calls.append("create")
            raise ConnectionError("no provider connection")

    monkeypatch.setattr(coach, "OpenAI", BrokenClient)
    with session_factory() as db:
        owner = _profile(db)
        conversation = Conversation(user_id=owner.id, title="New chat")
        db.add(conversation)
        db.commit()
        generation, _ = coach.reserve_generation(
            db, owner, conversation.id, uuid.uuid4(), "What is false grip?"
        )
        coach.run_generation(generation.id)
        db.expire_all()
        assert db.get(CoachGeneration, generation.id).status == "failed"
        assert db.get(Message, generation.assistant_message_id).status == "failed"
        assert calls == ["create"]


def test_completed_generation_settles_usage_once(session_factory, monkeypatch):
    settlements = []
    monkeypatch.setattr(
        coach, "consume_usage", lambda _db, usage_id: settlements.append(usage_id)
    )
    with session_factory() as db:
        owner = _profile(db)
        conversation = Conversation(user_id=owner.id, title="New chat")
        db.add(conversation)
        db.commit()
        generation, _ = coach.reserve_generation(
            db, owner, conversation.id, uuid.uuid4(), "How should I train?"
        )
        usage_id = uuid.uuid4()
        generation.feature_usage_id = usage_id
        db.commit()
        coach._set_state(
            generation.id,
            "completed",
            provider_response_id="resp_once",
            content="Train consistently.",
        )
        coach._set_state(
            generation.id,
            "completed",
            provider_response_id="resp_once",
            content="Train consistently.",
        )
        assert settlements == [usage_id]


def test_unpaywalled_safety_turn_bootstraps_later_provider_context(
    session_factory, monkeypatch
):
    calls = []

    class FakeClient:
        def __init__(self, **_kwargs):
            self.conversations = SimpleNamespace(
                create=lambda: SimpleNamespace(id="conv_safety")
            )
            self.responses = SimpleNamespace(create=self.respond)

        def respond(self, **kwargs):
            calls.append(kwargs)
            response = SimpleNamespace(
                id="resp_after_safety", output_text="Use easy variations."
            )
            return iter(
                (
                    SimpleNamespace(type="response.created", response=response),
                    SimpleNamespace(type="response.completed", response=response),
                )
            )

    monkeypatch.setattr(coach, "OpenAI", FakeClient)
    with session_factory() as db:
        owner = _profile(db)
        conversation = Conversation(user_id=owner.id, title="New chat")
        db.add(conversation)
        db.commit()
        safety, _ = coach.reserve_generation(
            db,
            owner,
            conversation.id,
            uuid.uuid4(),
            "My shoulder hurts during Pull-Ups",
        )
        assert safety.status == "completed" and calls == []
        paid, _ = coach.reserve_generation(
            db,
            owner,
            conversation.id,
            uuid.uuid4(),
            "How should I return to Pull-Ups safely?",
        )
        coach.run_generation(paid.id)
        db.expire_all()
        assert db.get(CoachGeneration, paid.id).status == "completed"
        assert "stop that movement" in calls[0]["input"]
        assert calls[0]["conversation"] == "conv_safety"


def test_lost_worker_exposes_interrupted_recovery_without_regeneration(
    session_factory, monkeypatch
):
    monkeypatch.setattr(coach_api, "SessionLocal", session_factory)
    with session_factory() as db:
        owner = _profile(db)
        conversation = Conversation(user_id=owner.id, title="New chat")
        db.add(conversation)
        db.commit()
        generation, _ = coach.reserve_generation(
            db, owner, conversation.id, uuid.uuid4(), "Help with Pull-Ups"
        )
        generation.status = "requesting"
        generation.updated_at = datetime.now(UTC) - timedelta(minutes=6)
        db.commit()
        recovered = coach_api._read_generation(owner.id, conversation.id, generation.id)
        assert recovered["status"] == "interrupted"
        assert recovered["error_code"] == "worker_lost"
        db.expire_all()
        assert db.get(Message, generation.assistant_message_id).status == "interrupted"


def test_api_persists_history_and_hides_other_users_conversations(
    session_factory, monkeypatch
):
    started = []
    monkeypatch.setattr(
        coach, "start_generation", lambda generation_id, _user_id: started.append(generation_id)
    )
    monkeypatch.setattr(coach_api, "SessionLocal", session_factory)
    with session_factory() as db:
        owner, stranger = _profile(db), _profile(db)
    identity = {"profile": owner}

    def database():
        with session_factory() as db:
            yield db

    app.dependency_overrides[get_db] = database
    app.dependency_overrides[require_athlete] = lambda: identity["profile"]
    try:
        with TestClient(app) as client:
            created = client.post("/coach/conversations")
            assert created.status_code == 201
            conversation_id = created.json()["id"]
            request_id = str(uuid.uuid4())
            sent = client.post(
                f"/coach/conversations/{conversation_id}/messages",
                json={
                    "client_request_id": request_id,
                    "content": "How do I improve Pull-Ups?",
                },
            )
            assert sent.status_code == 202
            repeat = client.post(
                f"/coach/conversations/{conversation_id}/messages",
                json={
                    "client_request_id": request_id,
                    "content": "How do I improve Pull-Ups?",
                },
            )
            assert repeat.json()["generation_id"] == sent.json()["generation_id"]
            assert repeat.json()["created"] is False
            with session_factory() as db:
                generation = db.get(
                    CoachGeneration, uuid.UUID(sent.json()["generation_id"])
                )
                assert generation is not None
            coach._set_state(
                generation.id,
                "completed",
                provider_response_id="resp_test",
                content="### Keep reps controlled",
            )
            history = client.get(f"/coach/conversations/{conversation_id}")
            assert [item["role"] for item in history.json()["messages"]] == [
                "user",
                "assistant",
            ]
            assert (
                history.json()["messages"][1]["content"] == "### Keep reps controlled"
            )
            events = client.get(
                f"/coach/conversations/{conversation_id}/generations/{generation.id}/events"
            )
            assert (
                events.status_code == 200 and "### Keep reps controlled" in events.text
            )
            identity["profile"] = stranger
            assert (
                client.get(f"/coach/conversations/{conversation_id}").status_code == 404
            )
            assert (
                client.get(
                    f"/coach/conversations/{conversation_id}/generations/{generation.id}"
                ).status_code
                == 404
            )
            assert (
                client.post(
                    f"/coach/conversations/{conversation_id}/messages",
                    json={
                        "client_request_id": str(uuid.uuid4()),
                        "content": "Unauthorized",
                    },
                ).status_code
                == 404
            )
            assert client.get("/coach/conversations").json() == []
            own = client.post("/coach/conversations").json()["id"]

            def deny(*_args, **_kwargs):
                raise FeatureAccessDeniedError("No Coach entitlement")

            monkeypatch.setattr(coach, "reserve_usage", deny)
            denied = client.post(
                f"/coach/conversations/{own}/messages",
                json={
                    "client_request_id": str(uuid.uuid4()),
                    "content": "How should I train?",
                },
            )
            assert denied.status_code == 403
            assert client.get(f"/coach/conversations/{own}").json()["messages"] == []
            safety = client.post(
                f"/coach/conversations/{own}/messages",
                json={
                    "client_request_id": str(uuid.uuid4()),
                    "content": "I have shoulder pain during Pull-Ups",
                },
            )
            assert safety.status_code == 202
            assert (
                client.get(f"/coach/conversations/{own}").json()["messages"][-1][
                    "status"
                ]
                == "completed"
            )
            assert len(started) == 1
    finally:
        app.dependency_overrides.pop(get_db, None)
        app.dependency_overrides.pop(require_athlete, None)


def test_first_send_api_and_owner_only_rename(session_factory, monkeypatch):
    started = []
    monkeypatch.setattr(coach, "start_generation", lambda generation_id, _user_id: started.append(generation_id))
    with session_factory() as db:
        owner, stranger = _profile(db), _profile(db)
    identity = {"profile": owner}

    def database():
        with session_factory() as db:
            yield db

    app.dependency_overrides[get_db] = database
    app.dependency_overrides[require_athlete] = lambda: identity["profile"]
    try:
        with TestClient(app) as client:
            request_id = str(uuid.uuid4())
            payload = {
                "client_request_id": request_id,
                "content": "How can I improve my false grip for muscle-ups?",
            }
            assert client.get("/coach/conversations").json() == []
            first = client.post("/coach/conversations/messages", json=payload)
            assert first.status_code == 202 and first.json()["created"] is True
            assert len(started) == 1
            conversation_id = first.json()["conversation"]["id"]
            assert first.json()["conversation"]["title"] == "Improving False Grip"
            retry = client.post("/coach/conversations/messages", json=payload)
            assert retry.status_code == 202 and retry.json()["created"] is False
            assert retry.json()["conversation"]["id"] == conversation_id
            with session_factory() as db:
                assert db.scalar(select(func.count(Conversation.id))) == 1
                assert db.scalar(select(func.count(CoachGeneration.id))) == 1
                generation = db.get(CoachGeneration, uuid.UUID(first.json()["generation_id"]))
                generation.status = "completed"
                db.get(Message, generation.assistant_message_id).status = "completed"
                db.commit()
            unrelated = client.post(
                f"/coach/conversations/{conversation_id}/messages",
                json={"client_request_id": str(uuid.uuid4()), "content": "What is freediving?"},
            )
            # Luna writes the boundary reply; there is no canned local answer.
            assert unrelated.status_code == 202 and unrelated.json()["created"] is True
            assert len(started) == 2
            renamed = client.patch(
                f"/coach/conversations/{conversation_id}",
                json={"title": "False Grip Practice"},
            )
            assert renamed.status_code == 200
            assert renamed.json()["title"] == "False Grip Practice"
            identity["profile"] = stranger
            assert client.patch(
                f"/coach/conversations/{conversation_id}",
                json={"title": "Unauthorized"},
            ).status_code == 404
            identity["profile"] = owner
            assert client.get(f"/coach/conversations/{conversation_id}").json()["title"] == "False Grip Practice"
    finally:
        app.dependency_overrides.pop(get_db, None)
        app.dependency_overrides.pop(require_athlete, None)


def test_live_sse_deltas_arrive_without_intermediate_database_writes(
    session_factory, monkeypatch
):
    monkeypatch.setattr(coach_api, "SessionLocal", session_factory)
    with session_factory() as db:
        owner = _profile(db)
        conversation = Conversation(user_id=owner.id, title="New chat")
        db.add(conversation)
        db.commit()
        generation, _ = coach.reserve_generation(
            db, owner, conversation.id, uuid.uuid4(), "How should I train?"
        )
        generation_id = generation.id
        assistant_id = generation.assistant_message_id
        conversation_id = conversation.id
    db_content_at_partial = []

    def producer():
        time.sleep(0.15)
        live_hub.publish(generation_id, "streaming", "First")
        with session_factory() as db:
            db_content_at_partial.append(db.get(Message, assistant_id).content)
        time.sleep(0.1)
        live_hub.publish(generation_id, "streaming", "First second")
        time.sleep(0.1)
        coach._set_state(generation_id, "completed", content="First second done")

    thread = threading.Thread(target=producer)
    app.dependency_overrides[require_athlete] = lambda: owner
    try:
        with TestClient(app) as client:
            thread.start()
            response = client.get(
                f"/coach/conversations/{conversation_id}/generations/{generation_id}/events"
            )
            thread.join(timeout=2)
            assert response.status_code == 200
            assert '"content": "First"' in response.text
            assert '"content": "First second"' in response.text
            assert '"content": "First second done"' in response.text
            assert db_content_at_partial == [""]
    finally:
        app.dependency_overrides.pop(require_athlete, None)


def _streaming_client(calls, events_for):
    class FakeClient:
        def __init__(self, **_kwargs):
            self.conversations = SimpleNamespace(
                create=lambda: SimpleNamespace(id=f"conv_{uuid.uuid4().hex[:6]}")
            )
            self.responses = SimpleNamespace(create=self.create_response)

        def create_response(self, **kwargs):
            calls.append(kwargs)
            return events_for(len(calls))

    return FakeClient


def test_first_delta_is_published_before_slow_streaming_saves(session_factory, monkeypatch):
    """A slow database must not sit between the provider and the browser."""
    published = []
    real_set_state = coach._set_state

    def slow_set_state(generation_id, status, **kwargs):
        if status not in coach.TERMINAL:
            time.sleep(0.4)
        real_set_state(generation_id, status, **kwargs)

    def events(_count):
        response = SimpleNamespace(id="resp_fast", output_text="Nice hold.", output=[])
        yield SimpleNamespace(type="response.created", response=response)
        yield SimpleNamespace(type="response.output_text.delta", delta="Nice hold.")
        yield SimpleNamespace(type="response.completed", response=response)

    calls = []
    monkeypatch.setattr(coach, "OpenAI", _streaming_client(calls, events))
    monkeypatch.setattr(coach, "_set_state", slow_set_state)
    real_publish = live_hub.publish

    def recording_publish(generation_id, status, content, error_code=None):
        published.append((time.monotonic(), status, content))
        real_publish(generation_id, status, content, error_code)

    monkeypatch.setattr(live_hub, "publish", recording_publish)
    with session_factory() as db:
        owner = _profile(db)
        conversation = Conversation(
            user_id=owner.id, title="New chat", openai_conversation_id="conv_ready"
        )
        db.add(conversation)
        db.commit()
        generation, _ = coach.reserve_generation(
            db, owner, conversation.id, uuid.uuid4(), "Is a 25-second one-leg Front Lever good?"
        )
        started = time.monotonic()
        coach.run_generation(generation.id)
        first_text = next(at for at, _status, content in published if content)
        assert first_text - started < 0.3
        db.expire_all()
        saved = db.get(CoachGeneration, generation.id)
        assert saved.status == "completed" and saved.provider_response_id == "resp_fast"
        assert db.get(Message, generation.assistant_message_id).content == "Nice hold."
    assert calls[0]["reasoning"] == {"effort": "low"}
    assert calls[0]["max_output_tokens"] == coach.COACH_MAX_OUTPUT_TOKENS
    assert len(calls) == 1


def test_late_streaming_save_never_overwrites_terminal_state(session_factory):
    with session_factory() as db:
        owner = _profile(db)
        conversation = Conversation(user_id=owner.id, title="New chat")
        db.add(conversation)
        db.commit()
        generation, _ = coach.reserve_generation(
            db, owner, conversation.id, uuid.uuid4(), "How should I train?"
        )
    coach._set_state(generation.id, "failed", content="Partial", error_code="provider_failed")
    coach._set_state(generation.id, "streaming", content="Older partial")
    with session_factory() as db:
        assert db.get(CoachGeneration, generation.id).status == "failed"
        assert db.get(Message, generation.assistant_message_id).content == "Partial"


def test_generation_runs_once_even_if_started_twice(session_factory, monkeypatch):
    calls = []

    def events(_count):
        response = SimpleNamespace(id=f"resp_{uuid.uuid4().hex[:6]}", output_text="Ok", output=[])
        yield SimpleNamespace(type="response.completed", response=response)

    monkeypatch.setattr(coach, "OpenAI", _streaming_client(calls, events))
    with session_factory() as db:
        owner = _profile(db)
        conversation = Conversation(user_id=owner.id, title="New chat")
        db.add(conversation)
        db.commit()
        generation, _ = coach.reserve_generation(
            db, owner, conversation.id, uuid.uuid4(), "What does a false grip mean?"
        )
    coach.run_generation(generation.id)
    coach.run_generation(generation.id)
    assert len(calls) == 1


def test_timing_marks_stay_server_side(session_factory, monkeypatch):
    from app.core.config import settings
    from app.services import coach_timing

    started = []
    monkeypatch.setattr(
        coach, "start_generation", lambda generation_id, _user_id: started.append(generation_id)
    )
    with session_factory() as db:
        owner = _profile(db)

    def database():
        with session_factory() as db:
            yield db

    app.dependency_overrides[get_db] = database
    app.dependency_overrides[require_athlete] = lambda: owner
    try:
        with TestClient(app) as client:
            sent = client.post(
                "/coach/conversations/messages",
                json={"client_request_id": str(uuid.uuid4()), "content": "What is a false grip?"},
            )
            assert sent.status_code == 202
            assert set(sent.json()) == {"conversation", "generation_id", "created"}
            assert "marks_ms" not in sent.text
    finally:
        app.dependency_overrides.pop(get_db, None)
        app.dependency_overrides.pop(require_athlete, None)
    monkeypatch.setattr(settings, "app_env", "production")
    monkeypatch.setattr(settings, "coach_timing_log", False)
    assert coach_timing.enabled() is False
    assert coach_timing.request_timeline() is None
    monkeypatch.setattr(settings, "coach_timing_log", True)
    assert coach_timing.enabled() is True


def test_slow_durable_poll_does_not_hold_back_live_text(session_factory, monkeypatch):
    monkeypatch.setattr(coach_api, "SessionLocal", session_factory)
    monkeypatch.setattr(coach_api, "DURABLE_POLL_SECONDS", 0.05)
    real_read = coach_api._read_generation
    reads = []

    def slow_read(*args):
        reads.append(args)
        if len(reads) > 1:
            time.sleep(1.5)
        return real_read(*args)

    monkeypatch.setattr(coach_api, "_read_generation", slow_read)
    with session_factory() as db:
        owner = _profile(db)
        conversation = Conversation(user_id=owner.id, title="New chat")
        db.add(conversation)
        db.commit()
        generation, _ = coach.reserve_generation(
            db, owner, conversation.id, uuid.uuid4(), "How should I train?"
        )

    def producer():
        time.sleep(0.25)
        live_hub.publish(generation.id, "streaming", "Live text")
        time.sleep(0.05)
        coach._set_state(generation.id, "completed", content="Live text done")

    thread = threading.Thread(target=producer)
    app.dependency_overrides[require_athlete] = lambda: owner
    try:
        with TestClient(app) as client:
            thread.start()
            started = time.monotonic()
            response = client.get(
                f"/coach/conversations/{conversation.id}/generations/{generation.id}/events"
            )
            elapsed = time.monotonic() - started
            thread.join(timeout=2)
            assert '"content": "Live text"' in response.text
            assert '"content": "Live text done"' in response.text
            assert len(reads) >= 2  # a slow durable poll was in flight
            assert elapsed < 1.0
    finally:
        app.dependency_overrides.pop(require_athlete, None)


def _delete_fixture(db: Session):
    owner, stranger = _profile(db), _profile(db)
    doomed = Conversation(
        user_id=owner.id, title="Front Lever", openai_conversation_id="conv_doomed"
    )
    kept = Conversation(user_id=owner.id, title="Pull-Ups")
    db.add_all((doomed, kept))
    db.commit()
    for conversation, question, response_id in (
        (doomed, "Build me a plan", "resp_doomed"),
        (kept, "Pull-Up tips", "resp_kept"),
    ):
        generation, _ = coach.reserve_generation(
            db, owner, conversation.id, uuid.uuid4(), question
        )
        coach._set_state(
            generation.id, "completed", provider_response_id=response_id, content="Done"
        )
    doomed_generation = db.scalar(
        select(CoachGeneration).where(CoachGeneration.conversation_id == doomed.id)
    )
    saved_plan = TrainingPlan(user_id=owner.id, title="Saved", plan_document={"days": []})
    db.add(saved_plan)
    db.flush()
    db.add(
        TrainingPlanPreview(
            user_id=owner.id,
            coach_generation_id=doomed_generation.id,
            plan_document={"days": []},
            saved_plan_id=saved_plan.id,
        )
    )
    db.commit()
    return owner, stranger, doomed, kept, saved_plan


def test_delete_conversation_is_owner_scoped_and_complete(session_factory, monkeypatch):
    cleanups = []
    monkeypatch.setattr(coach, "start_provider_cleanup", cleanups.append)
    with session_factory() as db:
        owner, stranger, doomed, kept, saved_plan = _delete_fixture(db)
    identity = {"profile": stranger}

    def database():
        with session_factory() as db:
            yield db

    app.dependency_overrides[get_db] = database
    app.dependency_overrides[require_athlete] = lambda: identity["profile"]
    try:
        with TestClient(app) as client:
            # Not-owned and missing look identical and delete nothing.
            foreign = client.delete(f"/coach/conversations/{doomed.id}")
            missing = client.delete(f"/coach/conversations/{uuid.uuid4()}")
            assert foreign.status_code == missing.status_code == 404
            assert foreign.json() == missing.json()
            assert cleanups == []
            with session_factory() as db:
                assert db.get(Conversation, doomed.id) is not None

            identity["profile"] = owner
            deleted = client.delete(f"/coach/conversations/{doomed.id}")
            assert deleted.status_code == 204 and deleted.content == b""
            assert cleanups == [["conv_doomed", "resp_doomed"]]
            # A repeat is a safe not-found, so retries are harmless.
            assert client.delete(f"/coach/conversations/{doomed.id}").status_code == 404
            assert client.get(f"/coach/conversations/{doomed.id}").status_code == 404
            listed = client.get("/coach/conversations").json()
            assert [item["id"] for item in listed] == [str(kept.id)]

            with session_factory() as db:
                for model, column in (
                    (Message, Message.conversation_id),
                    (CoachGeneration, CoachGeneration.conversation_id),
                ):
                    remaining = select(func.count()).select_from(model).where(column == doomed.id)
                    assert db.scalar(remaining) == 0
                assert db.scalar(select(func.count(TrainingPlanPreview.id))) == 0
                assert db.get(TrainingPlan, saved_plan.id) is not None
                assert len(coach.conversation_messages(db, kept.id)) == 2

            # Rename and New Chat still work after a deletion.
            renamed = client.patch(f"/coach/conversations/{kept.id}", json={"title": "Pull-Up Plan"})
            assert renamed.json()["title"] == "Pull-Up Plan"
            assert client.post("/coach/conversations").status_code == 201
    finally:
        app.dependency_overrides.pop(get_db, None)
        app.dependency_overrides.pop(require_athlete, None)


def test_delete_waits_for_in_flight_generation(session_factory, monkeypatch):
    with session_factory() as db:
        owner = _profile(db)
        conversation = Conversation(user_id=owner.id, title="New chat")
        db.add(conversation)
        db.commit()
        generation, _ = coach.reserve_generation(
            db, owner, conversation.id, uuid.uuid4(), "How should I train?"
        )
        ids = (owner.id, conversation.id, generation.id, generation.assistant_message_id)
        with pytest.raises(RuntimeError):
            coach.delete_conversation(db, ids[0], ids[1])
    owner_id, conversation_id, generation_id, assistant_id = ids
    with session_factory() as db:
        # The reply keeps streaming into intact rows.
        assert db.get(CoachGeneration, generation_id).status == "reserved"
    coach._set_state(generation_id, "streaming", content="Partial")
    coach._set_state(generation_id, "completed", provider_response_id="resp_1", content="Done")
    with session_factory() as db:
        assert db.get(Message, assistant_id).content == "Done"
        assert coach.delete_conversation(db, owner_id, conversation_id) == ["resp_1"]


def test_delete_api_reports_in_flight_conflict(session_factory, monkeypatch):
    monkeypatch.setattr(coach, "start_generation", lambda *_args: None)
    with session_factory() as db:
        owner = _profile(db)

    def database():
        with session_factory() as db:
            yield db

    app.dependency_overrides[get_db] = database
    app.dependency_overrides[require_athlete] = lambda: owner
    try:
        with TestClient(app) as client:
            sent = client.post(
                "/coach/conversations/messages",
                json={"client_request_id": str(uuid.uuid4()), "content": "Front Lever tips"},
            ).json()
            conversation_id = sent["conversation"]["id"]
            conflict = client.delete(f"/coach/conversations/{conversation_id}")
            assert conflict.status_code == 409
            assert client.get(f"/coach/conversations/{conversation_id}").status_code == 200
    finally:
        app.dependency_overrides.pop(get_db, None)
        app.dependency_overrides.pop(require_athlete, None)


def test_delete_recovers_a_lost_worker_first(session_factory, monkeypatch):
    settled = []
    monkeypatch.setattr(
        coach, "release_usage", lambda _db, usage_id, **_kw: settled.append(usage_id)
    )
    with session_factory() as db:
        owner = _profile(db)
        conversation = Conversation(user_id=owner.id, title="New chat")
        db.add(conversation)
        db.commit()
        generation, _ = coach.reserve_generation(
            db, owner, conversation.id, uuid.uuid4(), "How should I train?"
        )
        usage_id = uuid.uuid4()
        generation.feature_usage_id = usage_id
        generation.updated_at = datetime.now(UTC) - timedelta(minutes=6)
        db.commit()
        assert coach.delete_conversation(db, owner.id, conversation.id) == []
        assert settled == [usage_id]
        assert db.get(Conversation, conversation.id) is None


def test_provider_cleanup_deletes_conversation_and_responses(monkeypatch, caplog):
    from openai import OpenAIError

    deleted = []

    class FakeClient:
        def __init__(self, **_kwargs):
            self.conversations = SimpleNamespace(
                delete=lambda cid: deleted.append(("conversation", cid))
            )
            self.responses = SimpleNamespace(delete=self.delete_response)

        def delete_response(self, rid):
            if rid == "resp_gone":
                raise OpenAIError("not found")
            deleted.append(("response", rid))

    monkeypatch.setattr(coach, "OpenAI", FakeClient)
    coach.delete_provider_records(["conv_1", "resp_gone", "resp_2"])
    assert deleted == [("conversation", "conv_1"), ("response", "resp_2")]
    assert "resp_gone" in caplog.text
