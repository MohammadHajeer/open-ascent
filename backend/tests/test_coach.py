"""Offline coverage of durable Coach state and provider event handling."""

from __future__ import annotations

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
from app.models.training import WorkoutSession, WorkoutSet
from app.services import coach
from app.services.coach_context import build_coach_context
from app.services.coach_domain import DOMAIN_REDIRECT, classify_coach_request
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


@pytest.mark.parametrize(
    "question",
    [
        "How do I improve my Pull-Ups?",
        "How much rest between heavy sets?",
        "Are ring rows good for beginners?",
        "How can I improve wrist mobility for handstands?",
    ],
)
def test_domain_gate_allows_training_questions(question):
    assert classify_coach_request(question) == "in_domain"


@pytest.mark.parametrize(
    "question",
    [
        "What is freediving?",
        "Explain Bitcoin.",
        "Write Python code.",
        "Who should I vote for?",
    ],
)
def test_domain_gate_redirects_without_answering_unrelated_topic(session_factory, question):
    assert classify_coach_request(question) == "unrelated"
    with session_factory() as db:
        owner = _profile(db)
        conversation, generation, created = coach.create_and_reserve_generation(
            db, owner, uuid.uuid4(), question
        )
        assert created and generation.status == "completed"
        assert generation.feature_usage_id is None
        messages = coach.conversation_messages(db, conversation.id)
        assert len(messages) == 2
        assert messages[1].content == DOMAIN_REDIRECT
        assert not any(word in messages[1].content.lower() for word in ("bitcoin", "python", "vote", "freediving"))


def test_domain_gate_allows_contextual_and_explicit_training_connections():
    assert classify_coach_request(
        "What about wrist mobility?", ["How do I improve my handstand?"]
    ) == "in_domain"
    assert classify_coach_request(
        "Could freediving breath-hold training help my calisthenics?"
    ) == "adjacent_but_relevant"
    assert classify_coach_request(
        "What about that?", ["How do I improve my Pull-Ups?"]
    ) == "adjacent_but_relevant"
    assert classify_coach_request("What is freediving?", ["How do I improve my Pull-Ups?"]) == "unrelated"


@pytest.mark.parametrize(
    "message",
    [
        "Hello",
        "Hello coach!",
        "Hi!",
        "Hey",
        "Good morning",
        "How are you?",
        "Thanks",
        "Thanks, that helps",
        "Got it",
        "Okay",
        "Okay, thanks",
        "That makes sense",
        "Can you explain that again?",
        "Make it shorter",
        "Continue",
        "Why?",
    ],
)
def test_domain_gate_allows_ordinary_conversation(message):
    assert classify_coach_request(message) == "in_domain"


def test_greeting_reaches_coach_instead_of_domain_clarification(session_factory):
    with session_factory() as db:
        owner = _profile(db)
        conversation, generation, created = coach.create_and_reserve_generation(
            db, owner, uuid.uuid4(), "Hello"
        )
        assert created and generation.status == "reserved"
        assert coach.conversation_messages(db, conversation.id)[-1].content == ""
    assert classify_coach_request("Hey, explain Bitcoin") == "unrelated"


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
        coach, "start_generation", lambda generation_id: started.append(generation_id)
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
    monkeypatch.setattr(coach, "start_generation", lambda generation_id: started.append(generation_id))
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
            assert unrelated.status_code == 202
            assert len(started) == 1
            with session_factory() as db:
                assert coach.conversation_messages(db, uuid.UUID(conversation_id))[-1].content == DOMAIN_REDIRECT
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
