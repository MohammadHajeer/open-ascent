"""COACH-06 admission, validation, preview, ownership, and explicit Save tests."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError
from sqlalchemy import create_engine, event, func, select, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.api.dependencies.auth import require_athlete
from app.db.database import get_db
from app.main import app
from app.models.analysis import Analysis
from app.models.coach import CoachGeneration, Conversation, Message
from app.models.enums import FeatureKey
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
from app.schemas.readiness import ReadinessEvidence
from app.schemas.readiness_check import ReadinessAnswersInput
from app.schemas.training_plan import (
    PlanOrigin,
    WeeklyPlanCandidate,
    WeeklyPlanProposal,
)
from app.services import coach, plan_modes, training_plan
from app.services import coach_plan_generation as plan_generation
from app.services.feature_usage import QuotaExceededError
from app.services.readiness_check import store_answers
from app.services.readiness_evidence import ReadinessEvidenceBuilder
from scripts.seed_movements import MOVEMENTS, seed_movement


@compiles(JSONB, "sqlite")
def _jsonb_sqlite(_type, _compiler, **_kwargs):
    return "JSON"


@pytest.fixture
def plan_db(monkeypatch):
    engine = create_engine(
        "sqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False}
    )

    @event.listens_for(engine, "connect")
    def register_functions(connection, _record):
        connection.create_function("gen_random_uuid", 0, lambda: uuid.uuid4().hex)
        connection.create_function("now", 0, lambda: datetime.now(UTC).strftime("%Y-%m-%d %H:%M:%S.%f"))

    tables = (
        Profile.__table__, Movement.__table__, MovementDocumentation.__table__,
        ReadinessSelfReport.__table__, Analysis.__table__, Conversation.__table__,
        Message.__table__, CoachGeneration.__table__, TrainingPlan.__table__,
        TrainingPlanPreview.__table__, WorkoutSession.__table__, WorkoutSet.__table__,
    )
    defaults = [
        (column, column.server_default)
        for table in tables for column in table.columns
        if isinstance(column.type, JSONB)
    ]
    partial_indexes = [
        (table, index) for table in tables for index in list(table.indexes)
        if index.dialect_options["postgresql"].get("where") is not None
    ]
    for column, _default in defaults:
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
    # PostgreSQL's partial active-session index becomes an unconditional index
    # under SQLite, which would reject two completed historical sessions.
    with engine.begin() as connection:
        connection.execute(text("DROP INDEX IF EXISTS uq_workout_sessions_one_active_per_user"))
    factory = sessionmaker(engine, expire_on_commit=False)
    monkeypatch.setattr(coach, "SessionLocal", factory)
    owner = Profile(
        id=uuid.uuid4(), display_name="Owner", coaching_context={},
        initial_assessment={}, athlete_state={},
    )
    stranger = Profile(
        id=uuid.uuid4(), display_name="Stranger", coaching_context={},
        initial_assessment={}, athlete_state={},
    )
    movement = Movement(
        slug="test-pull-up", name="Pull-Up", family_key="pull",
        prescription_type="repetitions", upload_analysis_supported=True,
        live_coach_supported=False,
    )
    with factory() as db:
        db.add_all((owner, stranger, movement))
        db.flush()
        db.add(MovementDocumentation(
            movement_id=movement.id, version=1, status="published",
            content={
                "notice": "Train within your capacity.",
                "difficulty": "beginner",
                "stressed_areas": ["shoulders"],
                "prerequisites": ["Demonstrate control."],
                "cautions": ["Avoid painful movement."],
                "stop_conditions": ["Stop for pain."],
            },
            published_at=datetime.now(UTC),
        ))
        db.commit()
    yield factory, owner, stranger, movement
    engine.dispose()


def candidate(canonical_movement_id: uuid.UUID, **exercise_changes) -> WeeklyPlanCandidate:
    exercise = {
        "movement_id": str(canonical_movement_id), "sets": 3, "reps": 5,
        "hold_seconds": None, "rest_seconds": 90, "notes": None,
    }
    exercise.update(exercise_changes)
    return WeeklyPlanCandidate.model_validate({
        "title": "Weekly strength", "summary": "A modest week.",
        "days": [{"day_index": 1, "label": "Strength", "exercises": [exercise]}],
    })


def generation(db, owner: Profile, status: str = "streaming") -> CoachGeneration:
    conversation = Conversation(user_id=owner.id, title="Plan")
    db.add(conversation)
    db.flush()
    user = Message(
        conversation_id=conversation.id, position=0, role="user",
        content="Build a weekly plan", status="completed",
    )
    assistant = Message(
        conversation_id=conversation.id, position=1, role="assistant",
        content="", status="streaming",
    )
    db.add_all((user, assistant))
    db.flush()
    item = CoachGeneration(
        conversation_id=conversation.id, user_message_id=user.id,
        assistant_message_id=assistant.id, client_request_id=uuid.uuid4(),
        kind="plan", status=status,
    )
    db.add(item)
    db.commit()
    return item


def evidence(monkeypatch, satisfied: bool | None):
    monkeypatch.setattr(
        ReadinessEvidenceBuilder, "build",
        staticmethod(lambda *_args, **_kwargs: [ReadinessEvidence(
            requirement="Verified prerequisite", satisfied=satisfied,
            source="uploaded_analysis" if satisfied is not None else None,
        )]),
    )


@pytest.mark.parametrize("satisfied,code", [(False, "readiness_failed"), (None, "readiness_unknown")])
def test_only_pass_readiness_can_be_previewed(plan_db, monkeypatch, satisfied, code):
    factory, owner, _stranger, movement = plan_db
    evidence(monkeypatch, satisfied)
    with factory() as db:
        item = generation(db, owner)
        with pytest.raises(training_plan.PlanValidationError) as exc:
            training_plan.complete_preview(
                db, generation_id=item.id, user_id=owner.id,
                candidate=candidate(movement.id), provider_response_id="resp_invalid",
            )
        assert exc.value.code == code
        assert db.scalar(select(func.count(TrainingPlanPreview.id))) == 0
        assert db.scalar(select(func.count(TrainingPlan.id))) == 0


def test_missing_rules_remain_unknown(plan_db):
    factory, owner, _stranger, movement = plan_db
    with factory() as db:
        with pytest.raises(training_plan.PlanValidationError) as exc:
            training_plan.validate_candidate(db, owner.id, candidate(movement.id))
        assert exc.value.code == "readiness_unknown"


def test_canonical_and_prescription_gates(plan_db, monkeypatch):
    factory, owner, _stranger, movement = plan_db
    evidence(monkeypatch, True)
    with factory() as db:
        with pytest.raises(training_plan.PlanValidationError) as exc:
            training_plan.validate_candidate(db, owner.id, candidate(uuid.uuid4()))
        assert exc.value.code == "movement_not_found"
        with pytest.raises(training_plan.PlanValidationError) as exc:
            training_plan.validate_candidate(
                db, owner.id, candidate(movement.id, reps=None, hold_seconds=10)
            )
        assert exc.value.code == "prescription_mismatch"
        with pytest.raises(ValidationError):
            candidate(movement.id, reps=5, hold_seconds=10)
        with pytest.raises(ValidationError):
            candidate(movement.id, sets=999)


def test_duration_movement_uses_hold_target(plan_db, monkeypatch):
    factory, owner, _stranger, _movement = plan_db
    evidence(monkeypatch, True)
    with factory() as db:
        hold = Movement(
            slug="front-lever-test", name="Front Lever", family_key="lever",
            prescription_type="duration", upload_analysis_supported=False,
            live_coach_supported=False,
        )
        db.add(hold)
        db.flush()
        db.add(MovementDocumentation(
            movement_id=hold.id, version=1, status="published",
            content={
                "notice": "Train within your capacity.", "difficulty": "advanced",
                "stressed_areas": ["shoulders"], "prerequisites": [],
                "cautions": ["Avoid painful movement."],
                "stop_conditions": ["Stop for pain."],
            },
            published_at=datetime.now(UTC),
        ))
        db.commit()
        training_plan.validate_candidate(
            db, owner.id, candidate(hold.id, reps=None, hold_seconds=12)
        )
        with pytest.raises(training_plan.PlanValidationError) as exc:
            training_plan.validate_candidate(db, owner.id, candidate(hold.id))
        assert exc.value.code == "prescription_mismatch"


@pytest.mark.parametrize("change", [
    {"movement_id": "not-a-uuid"}, {"sets": 0}, {"reps": 0},
    {"rest_seconds": -1}, {"rest_seconds": 601},
    {"notes": "x" * 281}, {"reps": None, "hold_seconds": None},
    {"user_id": "model-supplied"},
])
def test_untrusted_exercise_fields_are_rejected(change):
    with pytest.raises(ValidationError):
        candidate(uuid.uuid4(), **change)


def test_weekly_shape_and_unknown_fields_are_rejected():
    movement_id = str(uuid.uuid4())
    valid_exercise = {
        "movement_id": movement_id, "sets": 2, "reps": 5,
        "hold_seconds": None, "rest_seconds": 60, "notes": None,
    }
    base = {"title": "Plan", "summary": None, "days": [{
        "day_index": 1, "label": None, "exercises": [valid_exercise],
    }]}
    for invalid in (
        {**base, "user_id": str(uuid.uuid4())},
        {**base, "title": "x" * 121},
        {**base, "days": []},
        {**base, "days": [base["days"][0]] * 2},
        {**base, "days": [{**base["days"][0], "exercises": [valid_exercise] * 9}]},
        {**base, "days": [{"day_index": n, "label": None, "exercises": [valid_exercise] * 4} for n in range(1, 8)]},
    ):
        with pytest.raises(ValidationError):
            WeeklyPlanCandidate.model_validate(invalid)
    with pytest.raises(ValidationError):
        WeeklyPlanProposal.model_validate({**base, "user_id": str(uuid.uuid4())})


def test_unpublished_movement_cannot_be_previewed(plan_db, monkeypatch):
    factory, owner, _stranger, movement = plan_db
    evidence(monkeypatch, True)
    with factory() as db:
        guide = db.scalar(select(MovementDocumentation).where(
            MovementDocumentation.movement_id == movement.id
        ))
        guide.status = "archived"
        db.commit()
        with pytest.raises(training_plan.PlanValidationError) as exc:
            training_plan.validate_candidate(db, owner.id, candidate(movement.id))
        assert exc.value.code == "movement_unpublished"


def test_preview_requires_explicit_save_and_is_idempotent(plan_db, monkeypatch):
    factory, owner, stranger, movement = plan_db
    evidence(monkeypatch, True)
    with factory() as db:
        item = generation(db, owner)
        with pytest.raises(training_plan.PlanNotFoundError):
            training_plan.complete_preview(
                db, generation_id=item.id, user_id=stranger.id,
                candidate=candidate(movement.id), provider_response_id="resp_wrong_owner",
            )
        preview = training_plan.complete_preview(
            db, generation_id=item.id, user_id=owner.id,
            candidate=candidate(movement.id), provider_response_id="resp_valid",
        )
        assert db.scalar(select(func.count(TrainingPlan.id))) == 0
        assert training_plan.preview_read(db, preview)["days"][0]["exercises"][0]["movement_slug"] == movement.slug
        with pytest.raises(training_plan.PlanNotFoundError):
            training_plan.get_owned_preview(db, stranger.id, preview.id)
        with pytest.raises(training_plan.PlanNotFoundError):
            training_plan.save_preview(db, stranger.id, preview.id)
        first = training_plan.save_preview(db, owner.id, preview.id)
        second = training_plan.save_preview(db, owner.id, preview.id)
        assert first.id == second.id
        assert db.scalar(select(func.count(TrainingPlan.id))) == 1
        with pytest.raises(training_plan.PlanNotFoundError):
            training_plan.get_owned_plan(db, stranger.id, first.id)


def test_save_rechecks_readiness_and_rejects_tampering(plan_db, monkeypatch):
    factory, owner, _stranger, movement = plan_db
    evidence(monkeypatch, True)
    with factory() as db:
        item = generation(db, owner)
        preview = training_plan.complete_preview(
            db, generation_id=item.id, user_id=owner.id,
            candidate=candidate(movement.id), provider_response_id="resp_save_gate",
        )
        evidence(monkeypatch, None)
        with pytest.raises(training_plan.PlanValidationError) as exc:
            training_plan.save_preview(db, owner.id, preview.id)
        assert exc.value.code == "readiness_unknown"
        evidence(monkeypatch, True)
        preview.plan_document = candidate(uuid.uuid4()).model_dump(mode="json")
        db.commit()
        with pytest.raises(training_plan.PlanValidationError) as exc:
            training_plan.save_preview(db, owner.id, preview.id)
        assert exc.value.code == "movement_not_found"
        assert db.scalar(select(func.count(TrainingPlan.id))) == 0


def test_api_rejects_client_plan_payload_and_cross_user_access(plan_db, monkeypatch):
    factory, owner, stranger, movement = plan_db
    evidence(monkeypatch, True)
    with factory() as db:
        item = generation(db, owner)
        preview = training_plan.complete_preview(
            db, generation_id=item.id, user_id=owner.id,
            candidate=candidate(movement.id), provider_response_id="resp_api",
        )

    identity = {"profile": stranger}

    def database():
        with factory() as db:
            yield db

    app.dependency_overrides[get_db] = database
    app.dependency_overrides[require_athlete] = lambda: identity["profile"]
    try:
        with TestClient(app) as client:
            path = f"/coach/plans/previews/{preview.id}"
            assert client.get(path).status_code == 404
            assert client.post(path + "/save", json={}).status_code == 404
            identity["profile"] = owner
            assert client.post(path + "/save", json={"title": "Tampered"}).status_code == 422
            with factory() as db:
                assert db.scalar(select(func.count(TrainingPlan.id))) == 0
            assert client.get(path).status_code == 200
            history = client.get(f"/coach/conversations/{item.conversation_id}")
            assert history.status_code == 200
            assert history.json()["messages"][1]["plan_preview_id"] == str(preview.id)
            saved = client.post(path + "/save", json={})
            assert saved.status_code == 200
            assert client.post(path + "/save", json={}).json()["id"] == saved.json()["id"]
            identity["profile"] = stranger
            assert client.get(f"/coach/plans/{saved.json()['id']}").status_code == 404
    finally:
        app.dependency_overrides.clear()


def test_library_lists_only_owned_saved_plans_and_reads_prescriptions(plan_db, monkeypatch):
    factory, owner, stranger, movement = plan_db
    evidence(monkeypatch, True)
    with factory() as db:
        item = generation(db, owner)
        preview = training_plan.complete_preview(
            db, generation_id=item.id, user_id=owner.id,
            candidate=candidate(movement.id), provider_response_id="resp_library",
        )
        preview_id = preview.id

    identity = {"profile": owner}

    def database():
        with factory() as db:
            yield db

    app.dependency_overrides[get_db] = database
    app.dependency_overrides[require_athlete] = lambda: identity["profile"]
    try:
        with TestClient(app) as client:
            assert client.get("/coach/plans").json() == []
            saved = client.post(f"/coach/plans/previews/{preview_id}/save", json={})
            assert saved.status_code == 200
            plan_id = saved.json()["id"]
            listing = client.get("/coach/plans")
            assert listing.status_code == 200
            assert len(listing.json()) == 1
            assert listing.json()[0]["id"] == plan_id
            assert listing.json()[0]["training_day_count"] == 1
            assert listing.json()[0]["movement_count"] == 1
            detail = client.get(f"/coach/plans/{plan_id}")
            assert detail.status_code == 200
            exercise = detail.json()["days"][0]["exercises"][0]
            assert exercise["movement_name"] == "Pull-Up"
            assert (exercise["reps"], exercise["hold_seconds"]) == (5, None)
            assert client.get(f"/coach/plans/{uuid.uuid4()}").status_code == 404
            assert client.get("/coach/plans/not-a-uuid").status_code == 422
            identity["profile"] = stranger
            assert client.get("/coach/plans").json() == []
            assert client.get(f"/coach/plans/{plan_id}").status_code == 404
    finally:
        app.dependency_overrides.clear()


def test_library_reads_saved_hold_prescription(plan_db):
    factory, owner, _stranger, movement = plan_db
    document = candidate(movement.id, reps=None, hold_seconds=30).model_dump(mode="json")
    with factory() as db:
        plan = TrainingPlan(user_id=owner.id, title="Hold week", plan_document=document)
        db.add(plan)
        db.commit()
        read = training_plan.saved_plan_read(db, plan)
        exercise = read["days"][0]["exercises"][0]
        assert (exercise["reps"], exercise["hold_seconds"]) == (None, 30)


def test_library_modes_are_canonical_and_profile_remains_provisional(plan_db):
    factory, owner, _stranger, movement = plan_db
    owner.coaching_context = {"primary_goal": "strength", "equipment": ["pull_up_bar"],
                              "availability": {"days_per_week": 3, "minutes_per_session": 40}}
    owner.initial_assessment = {"answers": {"training_experience": "some",
                                "max_clean_reps": {"pull_up": 3}}}
    with factory() as db:
        db.merge(owner)
        db.commit()
        profile_request = LibraryPlanRequest(client_request_id=uuid.uuid4(), mode="profile")
        content, metadata = plan_modes.normalize_request(db, owner.id, profile_request)
        assert metadata["mode"] == "profile"
        context = plan_modes.generation_context(db, owner, metadata)
        assert "starting_self_reported_clean_rep_max" in context
        assert "measured" not in context
        goal_request = LibraryPlanRequest(client_request_id=uuid.uuid4(), mode="goal", goal_movement_id=movement.id)
        content, metadata = plan_modes.normalize_request(db, owner.id, goal_request)
        assert metadata["goal"]["movement_id"] == str(movement.id)
        assert "prerequisites" in content
        assert "goal_readiness_for_guidance_only" in plan_modes.generation_context(db, owner, metadata)
        with pytest.raises(ValueError):
            plan_modes.normalize_request(db, owner.id, LibraryPlanRequest(
                client_request_id=uuid.uuid4(), mode="goal", goal_movement_id=uuid.uuid4()))
    with pytest.raises(ValidationError):
        LibraryPlanRequest.model_validate({"client_request_id": str(uuid.uuid4()), "mode": "goal", "goal_movement_id": str(movement.id), "user_id": str(owner.id)})


def test_mode_metadata_survives_preview_save_and_legacy_plan(plan_db, monkeypatch):
    factory, owner, _stranger, movement = plan_db
    evidence(monkeypatch, True)
    with factory() as db:
        item = generation(db, owner)
        proposed = candidate(movement.id).model_copy(update={"origin": PlanOrigin.model_validate({
            "mode": "goal", "goal_name": "Muscle-Up", "based_on": ["selected goal", "movement readiness"], "note": None
        })})
        proposed = WeeklyPlanCandidate.model_validate(proposed.model_dump())
        preview = training_plan.complete_preview(db, generation_id=item.id, user_id=owner.id,
            candidate=proposed, provider_response_id="resp_origin")
        assert training_plan.preview_read(db, preview)["origin"]["goal_name"] == "Muscle-Up"
        saved = training_plan.save_preview(db, owner.id, preview.id)
        assert training_plan.saved_plan_summary(saved)["origin"]["mode"] == "goal"
        legacy = TrainingPlan(user_id=owner.id, title="Old plan", plan_document=candidate(movement.id).model_dump(mode="json"))
        db.add(legacy)
        db.commit()
        assert training_plan.saved_plan_read(db, legacy)["origin"] is None


def test_progress_mode_needs_two_sessions_and_reuses_coach_03(plan_db):
    factory, owner, _stranger, movement = plan_db
    request = LibraryPlanRequest(client_request_id=uuid.uuid4(), mode="progress")
    with factory() as db:
        with pytest.raises(plan_modes.ProgressUnavailable, match="at least two workouts"):
            plan_modes.normalize_request(db, owner.id, request)
        for offset, reps in ((7, 3), (0, 5)):
            started = datetime.now(UTC) - timedelta(days=offset)
            session = WorkoutSession(user_id=owner.id, source="manual", started_at=started,
                                     completed_at=started + timedelta(minutes=25))
            db.add(session)
            db.flush()
            db.add(WorkoutSet(session_id=session.id, movement_id=movement.id, position=0,
                              source="manual", performer="self", intent="training_set", reps=reps))
        db.commit()
        _, metadata = plan_modes.normalize_request(db, owner.id, request)
        context = plan_modes.generation_context(db, owner, metadata)
        assert "COACH-03 self-attributed workout progress" in context
        assert '"value":3.0' in context and '"value":5.0' in context
        assert "fitness_score" not in context


def test_goal_readiness_does_not_gate_eligible_precursor(plan_db, monkeypatch):
    factory, owner, _stranger, precursor = plan_db
    with factory() as db:
        goal = Movement(slug="muscle-up", name="Muscle-Up", family_key="vertical_pull",
                        prescription_type="repetitions")
        db.add(goal)
        db.flush()
        db.add(MovementDocumentation(movement_id=goal.id, version=1, status="published",
            content={"notice": "Train safely.", "difficulty": "advanced", "stressed_areas": [],
                     "prerequisites": [], "cautions": [], "stop_conditions": []},
            published_at=datetime.now(UTC)))
        db.commit()
        monkeypatch.setattr(ReadinessEvidenceBuilder, "build", staticmethod(
            lambda _db, *, user_id, movement_id: [ReadinessEvidence(
                requirement="Measured prerequisite", satisfied=(True if movement_id == precursor.id else None),
                source="uploaded_analysis" if movement_id == precursor.id else None)]
        ))
        assert [item["id"] for item in plan_generation._eligible_movements(db, owner.id)] == [str(precursor.id)]
        request = LibraryPlanRequest(client_request_id=uuid.uuid4(), mode="goal", goal_movement_id=goal.id)
        _, metadata = plan_modes.normalize_request(db, owner.id, request)
        context = plan_modes.generation_context(db, owner, metadata)
        assert '"status":"unknown"' in context
        training_plan.validate_candidate(db, owner.id, candidate(precursor.id))
        with pytest.raises(training_plan.PlanValidationError, match="cannot be prescribed yet"):
            training_plan.validate_candidate(db, owner.id, candidate(goal.id))


def test_library_schedule_and_equipment_rechecked(plan_db, monkeypatch):
    factory, owner, _stranger, movement = plan_db
    evidence(monkeypatch, True)
    with factory() as db:
        db.get(Movement, movement.id).slug = "pull-up"
        profile = db.get(Profile, owner.id)
        profile.coaching_context = {"equipment": ["none"], "availability": {"days_per_week": 1}}
        db.commit()
        item = generation(db, owner)
        item.plan_context = {"mode": "profile", "note": None}
        db.commit()
        with pytest.raises(training_plan.PlanValidationError) as exc:
            training_plan.complete_preview(db, generation_id=item.id, user_id=owner.id,
                candidate=candidate(movement.id).model_copy(update={"origin": PlanOrigin(
                    mode="profile", based_on=["onboarding"], goal_name=None, note=None)}),
                provider_response_id="resp_equipment")
        assert exc.value.code == "equipment_unavailable"
        profile.coaching_context = {"equipment": ["pull_up_bar"], "availability": {"days_per_week": 1}}
        db.commit()
        two_days = candidate(movement.id).model_dump(mode="json")
        two_days["days"].append({**two_days["days"][0], "day_index": 2})
        with pytest.raises(training_plan.PlanValidationError) as exc:
            training_plan.complete_preview(db, generation_id=item.id, user_id=owner.id,
                candidate=WeeklyPlanCandidate.model_validate(two_days), provider_response_id="resp_schedule")
        assert exc.value.code == "availability_exceeded"


def test_library_generation_endpoint_uses_authenticated_owner_and_rejects_extra_identity(plan_db, monkeypatch):
    factory, owner, _stranger, movement = plan_db
    captured = []

    def admit(_db, profile, request_id, content, *, kind, plan_context):
        captured.append((profile.id, request_id, content, kind, plan_context))
        return SimpleNamespace(id=uuid.uuid4()), SimpleNamespace(id=uuid.uuid4(), status="completed"), True

    monkeypatch.setattr(coach, "create_and_reserve_generation", admit)
    monkeypatch.setattr("app.api.training_plans.preflight", lambda *_args: {"status": "ready", "questions": []})

    def database():
        with factory() as db:
            yield db

    app.dependency_overrides[get_db] = database
    app.dependency_overrides[require_athlete] = lambda: owner
    try:
        with TestClient(app) as client:
            payload = {"client_request_id": str(uuid.uuid4()), "mode": "goal", "goal_movement_id": str(movement.id)}
            response = client.post("/coach/plans/generations", json=payload)
            assert response.status_code == 202
            assert captured[0][0] == owner.id
            assert captured[0][3] == "plan"
            assert captured[0][4]["goal"]["movement_id"] == str(movement.id)
            assert client.post("/coach/plans/generations", json={**payload, "user_id": str(owner.id)}).status_code == 422
    finally:
        app.dependency_overrides.clear()


def test_quick_check_is_unmetered_and_generation_still_uses_existing_admission(plan_db, monkeypatch):
    factory, owner, stranger, _movement = plan_db
    with factory() as db:
        seed_movement(db, next(item for item in MOVEMENTS if item["slug"] == "push-up"))
        db.commit()
    admissions = []

    def admit(_db, profile, request_id, content, *, kind, plan_context):
        admissions.append((profile.id, request_id, kind))
        return SimpleNamespace(id=uuid.uuid4()), SimpleNamespace(id=uuid.uuid4(), status="completed"), True

    monkeypatch.setattr(coach, "create_and_reserve_generation", admit)

    def database():
        with factory() as db:
            yield db

    app.dependency_overrides[get_db] = database
    app.dependency_overrides[require_athlete] = lambda: owner
    try:
        with TestClient(app) as client:
            request = {"client_request_id": str(uuid.uuid4()), "mode": "profile"}
            blocked = client.post("/coach/plans/generations", json=request)
            assert blocked.status_code == 409
            assert admissions == []
            check = client.post("/coach/plans/preflight", json=request)
            assert check.status_code == 200
            assert check.json()["status"] == "check_required"
            question = check.json()["questions"][0]
            assert question["rule_code"] == "recent_logged_push_up"
            assert client.post("/coach/plans/readiness-check", json={"answers": [{
                "movement_id": question["movement_id"],
                "documentation_id": question["documentation_id"],
                "rule_code": question["rule_code"], "response": "able",
                "user_id": str(stranger.id),
            }]}).status_code == 422
            assert client.post("/coach/plans/readiness-check", json={"answers": [{
                "movement_id": question["movement_id"],
                "documentation_id": question["documentation_id"],
                "rule_code": question["rule_code"], "response": "able",
            }]}).status_code == 200
            assert admissions == []
            assert client.post("/coach/plans/preflight", json=request).json()["status"] == "ready"
            assert client.post("/coach/plans/generations", json=request).status_code == 202
            assert admissions == [(owner.id, uuid.UUID(request["client_request_id"]), "plan")]
    finally:
        app.dependency_overrides.clear()


def test_provisional_basis_is_labelled_in_preview_and_saved_plan(plan_db):
    factory, owner, _stranger, _movement = plan_db
    with factory() as db:
        seed_movement(db, next(item for item in MOVEMENTS if item["slug"] == "push-up"))
        target = db.scalar(select(Movement).where(Movement.slug == "push-up"))
        guide = db.scalar(select(MovementDocumentation).where(
            MovementDocumentation.movement_id == target.id,
            MovementDocumentation.status == "published",
        ))
        db.commit()
        store_answers(db, owner.id, ReadinessAnswersInput.model_validate({"answers": [{
            "movement_id": target.id, "documentation_id": guide.id,
            "rule_code": "recent_logged_push_up", "response": "able",
        }]}))
        item = generation(db, owner)
        preview = training_plan.complete_preview(
            db, generation_id=item.id, user_id=owner.id,
            candidate=candidate(target.id), provider_response_id="resp_provisional",
        )
        assert training_plan.preview_read(db, preview)["provisional_readiness"] is True
        saved = training_plan.save_preview(db, owner.id, preview.id)
        assert training_plan.saved_plan_summary(saved)["provisional_readiness"] is True


def test_plan_admission_uses_one_plan_unit_and_safe_idempotency(plan_db, monkeypatch):
    factory, owner, _stranger, _movement = plan_db
    calls = []

    def reserve(_db, **kwargs):
        calls.append(kwargs)

    monkeypatch.setattr(coach, "reserve_usage", reserve)
    with factory() as db:
        request_id = uuid.uuid4()
        _conversation, item, created = coach.create_and_reserve_generation(
            db, owner, request_id, "Build me a weekly plan", kind="plan"
        )
        assert created and item.kind == "plan"
        _conversation, retry, created = coach.create_and_reserve_generation(
            db, owner, request_id, "Build me a weekly plan", kind="plan"
        )
        assert not created and retry.id == item.id
        assert len(calls) == 1
        assert calls[0]["feature_key"] is FeatureKey.TRAINING_PLAN_GENERATION
        assert calls[0]["operation_key"] == str(request_id)
        with pytest.raises(ValueError):
            coach.create_and_reserve_generation(
                db, owner, request_id, "Build me a weekly plan", kind="chat"
            )
        with pytest.raises(ValueError):
            coach.create_and_reserve_generation(
                db, owner, request_id, "Build me a weekly plan", kind="plan",
                plan_context={"mode": "goal", "goal": {"name": "Muscle-Up"}},
            )


def test_plan_quota_failure_creates_no_generation(plan_db, monkeypatch):
    factory, owner, _stranger, _movement = plan_db

    def denied(*_args, **_kwargs):
        raise QuotaExceededError("limit")

    monkeypatch.setattr(coach, "reserve_usage", denied)
    with factory() as db:
        with pytest.raises(QuotaExceededError):
            coach.create_and_reserve_generation(
                db, owner, uuid.uuid4(), "Build me a weekly plan", kind="plan"
            )
        db.rollback()
        assert db.scalar(select(func.count(CoachGeneration.id))) == 0


def test_provider_tool_round_yields_structured_preview_without_saving(plan_db, monkeypatch):
    factory, owner, _stranger, movement = plan_db
    evidence(monkeypatch, True)
    monkeypatch.setattr(plan_generation, "SessionLocal", factory)
    monkeypatch.setattr(plan_generation, "build_coach_context", lambda *_args: "Goal: strength")
    monkeypatch.setattr(plan_generation, "_eligible_movements", lambda *_args: [
        {"id": str(movement.id), "name": movement.name, "prescription_type": "repetitions"}
    ])
    seen_tools = []
    monkeypatch.setattr(
        plan_generation, "execute_tool",
        lambda _db, context, name, arguments: (
            seen_tools.append((context.user_id, name, arguments)) or '{"goal":"strength"}'
        ),
    )
    calls = []
    proposal = plan_generation.WeeklyPlanProposal.model_validate(
        candidate(movement.id).model_dump(mode="json", exclude={"origin", "provisional_readiness"})
    )

    class FakeResponses:
        def parse(self, **kwargs):
            calls.append(kwargs)
            if len(calls) == 1:
                return SimpleNamespace(
                    id="resp_tool", status="completed", output=[SimpleNamespace(
                        type="function_call", call_id="call_1",
                        name="get_athlete_profile_context", arguments="{}",
                    )], output_parsed=None,
                )
            return SimpleNamespace(
                id="resp_plan", status="completed", output=[], output_parsed=proposal,
            )

    class FakeOpenAI:
        def __init__(self, **_kwargs):
            self.conversations = SimpleNamespace(create=lambda: SimpleNamespace(id="conv_plan"))
            self.responses = FakeResponses()

    monkeypatch.setattr(plan_generation, "OpenAI", FakeOpenAI)
    with factory() as db:
        item = generation(db, owner, status="reserved")
        conversation_id = item.conversation_id
    coach.run_generation(item.id, owner.id)
    with factory() as db:
        assert db.get(CoachGeneration, item.id).status == "completed"
        assert db.scalar(select(func.count(TrainingPlanPreview.id))) == 1
        assert db.scalar(select(func.count(TrainingPlan.id))) == 0
        assert db.get(Conversation, conversation_id).openai_conversation_id == "conv_plan"
    assert len(calls) == 2
    assert calls[0]["text_format"] is plan_generation.WeeklyPlanProposal
    assert calls[0]["conversation"] == "conv_plan"
    assert calls[1]["input"][0]["type"] == "function_call_output"
    assert seen_tools == [(owner.id, "get_athlete_profile_context", "{}")]
    assert len(calls[0]["tools"]) == 7
    assert all(item["type"] == "function" for item in calls[0]["tools"])


def test_malformed_provider_plan_cannot_create_preview(plan_db, monkeypatch):
    factory, owner, _stranger, movement = plan_db
    evidence(monkeypatch, True)
    monkeypatch.setattr(plan_generation, "SessionLocal", factory)
    monkeypatch.setattr(plan_generation, "build_coach_context", lambda *_args: "Goal: strength")
    monkeypatch.setattr(plan_generation, "_eligible_movements", lambda *_args: [
        {"id": str(movement.id), "name": movement.name, "prescription_type": "repetitions"}
    ])

    class FakeOpenAI:
        def __init__(self, **_kwargs):
            self.conversations = SimpleNamespace(create=lambda: SimpleNamespace(id="conv_bad"))
            self.responses = SimpleNamespace(parse=lambda **_kwargs: SimpleNamespace(
                id="resp_bad", status="completed", output=[],
                output_parsed=plan_generation.WeeklyPlanProposal.model_validate({
                    "title": "Bad", "summary": None,
                    "days": [{"day_index": 1, "label": None, "exercises": [{
                        "movement_id": str(movement.id), "sets": -1, "reps": 5,
                        "hold_seconds": None, "rest_seconds": 30, "notes": None,
                    }]}],
                }),
            ))

    monkeypatch.setattr(plan_generation, "OpenAI", FakeOpenAI)
    with factory() as db:
        item = generation(db, owner, status="reserved")
    coach.run_generation(item.id, owner.id)
    with factory() as db:
        updated = db.get(CoachGeneration, item.id)
        assert updated.status == "failed"
        assert updated.error_code == "invalid_plan"
        assert db.scalar(select(func.count(TrainingPlanPreview.id))) == 0
        assert db.scalar(select(func.count(TrainingPlan.id))) == 0
