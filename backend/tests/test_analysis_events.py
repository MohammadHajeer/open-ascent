from __future__ import annotations

import json
import uuid
from contextlib import contextmanager
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.api import analysis_stream
from app.core.config import settings
from app.core.guest_credentials import hash_guest_token
from app.models.analysis import Analysis
from app.models.analysis_event import AnalysisEvent
from app.models.movement import Movement
from app.models.movement_documentation import MovementDocumentation
from app.services.analysis_events import publish_claim_event, record_analysis_event
from app.services.analysis_jobs import (
    AnalysisClaim,
    AnalysisClaimLostError,
    claim_next_analysis,
    complete_analysis,
    fail_analysis,
)


@pytest.fixture
def guest_event_analysis(db: Session, monkeypatch: pytest.MonkeyPatch):
    suffix = uuid.uuid4().hex[:8]
    movement = Movement(
        slug=f"event-test-{suffix}",
        name="Event test",
        family_key="vertical_pull",
        upload_analysis_supported=True,
        live_coach_supported=False,
    )
    db.add(movement)
    db.flush()
    documentation = MovementDocumentation(
        movement_id=movement.id,
        version=1,
        status="published",
        content={"notice": "Use a stable bar."},
        published_at=datetime.now(UTC),
    )
    db.add(documentation)
    db.flush()
    credential = f"oa_guest_{uuid.uuid4().hex}"
    now = datetime.now(UTC)
    analysis = Analysis(
        movement_id=movement.id,
        safety_documentation_id=documentation.id,
        safety_ack_version="v1",
        safety_acknowledged_at=now,
        owner_kind="guest",
        status="queued",
        stage="queued",
        video_path="private/source.mp4",
        guest_token_hash=hash_guest_token(credential, settings.guest_token_secret),
        guest_rate_key="event-test",
        reservation_operation_key=str(uuid.uuid4()),
        request_fingerprint=uuid.uuid4().hex,
        reservation_expires_at=now + timedelta(minutes=15),
        access_expires_at=now + timedelta(hours=1),
        purge_after=now + timedelta(days=1),
    )
    db.add(analysis)
    db.flush()
    record_analysis_event(
        db, analysis_id=analysis.id, attempt=0, event_type="analysis_queued"
    )
    db.commit()

    @contextmanager
    def same_test_session():
        yield db

    monkeypatch.setattr(analysis_stream, "SessionLocal", same_test_session)
    yield analysis, credential
    db.execute(delete(Analysis).where(Analysis.id == analysis.id))
    db.execute(
        delete(MovementDocumentation).where(
            MovementDocumentation.id == documentation.id
        )
    )
    db.execute(delete(Movement).where(Movement.id == movement.id))
    db.commit()


def event_url(analysis: Analysis) -> str:
    return f"/analyses/{analysis.id}/events"


def bearer(credential: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {credential}"}


def stream_types(body: str) -> list[str]:
    return [
        line.removeprefix("event: ")
        for line in body.splitlines()
        if line.startswith("event: ")
    ]


def make_completed(db: Session, analysis: Analysis) -> AnalysisClaim:
    claim = claim_next_analysis(db)
    assert claim is not None and claim.analysis_id == analysis.id
    publish_claim_event(db, claim, "video_loaded")
    publish_claim_event(db, claim, "movement_analysis_started")
    publish_claim_event(db, claim, "rep_completed", rep_index=1, outcome="valid")
    publish_claim_event(db, claim, "rep_completed", rep_index=2, outcome="partial")
    publish_claim_event(db, claim, "finalizing")
    complete_analysis(
        db,
        claim,
        result_data={"raw_landmarks": [123], "internal_frame": 9},
        analyzer_version="test",
        model_version="test",
    )
    analysis.ai_feedback_status = "skipped"
    db.commit()
    return claim


def test_guest_credential_is_required_and_id_alone_cannot_subscribe(
    client: TestClient, guest_event_analysis
) -> None:
    analysis, _ = guest_event_analysis
    assert client.get(event_url(analysis)).status_code == 401
    assert client.get(event_url(analysis), headers=bearer("wrong")).status_code == 401


def test_stream_replays_ordered_product_events_without_raw_data(
    client: TestClient, db: Session, guest_event_analysis
) -> None:
    analysis, credential = guest_event_analysis
    make_completed(db, analysis)
    response = client.get(event_url(analysis), headers=bearer(credential))
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/event-stream")
    assert stream_types(response.text) == [
        "analysis_queued",
        "processing_started",
        "video_loaded",
        "movement_analysis_started",
        "rep_completed",
        "rep_completed",
        "finalizing",
        "completed",
        "state",
    ]
    rep_payloads = [
        json.loads(line.removeprefix("data: "))
        for line in response.text.splitlines()
        if line.startswith("data: ") and '"rep_index"' in line
    ]
    assert [(payload["rep_index"], payload["outcome"]) for payload in rep_payloads] == [
        (1, "valid"),
        (2, "partial"),
    ]
    assert "raw_landmarks" not in response.text
    assert "internal_frame" not in response.text
    ids = [
        int(line.removeprefix("id: "))
        for line in response.text.splitlines()
        if line.startswith("id: ")
    ]
    assert ids == sorted(set(ids))


def test_reconnect_replays_only_missed_events_and_does_not_create_work(
    client: TestClient, db: Session, guest_event_analysis
) -> None:
    analysis, credential = guest_event_analysis
    make_completed(db, analysis)
    events = list(
        db.scalars(
            select(AnalysisEvent)
            .where(AnalysisEvent.analysis_id == analysis.id)
            .order_by(AnalysisEvent.id)
        )
    )
    count_before = len(events)
    cursor = events[4].id  # First completed rep.
    headers = {**bearer(credential), "Last-Event-ID": str(cursor)}
    first = client.get(event_url(analysis), headers=headers)
    second = client.get(event_url(analysis), headers=headers)
    assert first.status_code == second.status_code == 200
    assert stream_types(first.text) == [
        "rep_completed",
        "finalizing",
        "completed",
        "state",
    ]
    assert first.text == second.text
    assert f"id: {cursor}\r\n" not in first.text
    assert (
        db.scalar(
            select(func.count())
            .select_from(AnalysisEvent)
            .where(AnalysisEvent.analysis_id == analysis.id)
        )
        == count_before
    )
    db.refresh(analysis)
    assert analysis.attempts == 1
    assert analysis.status == "completed"
    assert '"status":"completed"' in first.text
    terminal_resume = client.get(
        event_url(analysis),
        headers={**bearer(credential), "Last-Event-ID": str(events[-1].id)},
    )
    assert terminal_resume.status_code == 200
    assert stream_types(terminal_resume.text) == ["state"]
    assert '"status":"completed"' in terminal_resume.text


def test_failed_event_is_safe_and_reconnect_is_terminal(
    client: TestClient, db: Session, guest_event_analysis
) -> None:
    analysis, credential = guest_event_analysis
    claim = claim_next_analysis(db)
    assert claim is not None
    fail_analysis(db, claim, error_code="private_storage_stack_trace")
    response = client.get(event_url(analysis), headers=bearer(credential))
    assert response.status_code == 200
    assert stream_types(response.text)[-2:] == ["failed", "state"]
    assert "private_storage_stack_trace" not in response.text


def test_stale_attempt_cannot_publish_progress_or_completion(
    db: Session, guest_event_analysis
) -> None:
    analysis, _ = guest_event_analysis
    old_claim = claim_next_analysis(db)
    assert old_claim is not None
    analysis.lease_expires_at = datetime.now(UTC) - timedelta(minutes=1)
    db.commit()
    new_claim = claim_next_analysis(db)
    assert new_claim is not None and new_claim.attempt == 2
    with pytest.raises(AnalysisClaimLostError):
        publish_claim_event(
            db, old_claim, "rep_completed", rep_index=1, outcome="valid"
        )
    with pytest.raises(AnalysisClaimLostError):
        complete_analysis(
            db, old_claim, result_data={}, analyzer_version="old", model_version="old"
        )
    publish_claim_event(db, new_claim, "rep_completed", rep_index=1, outcome="partial")
    complete_analysis(
        db, new_claim, result_data={}, analyzer_version="new", model_version="new"
    )
    events = list(
        db.scalars(
            select(AnalysisEvent).where(AnalysisEvent.analysis_id == analysis.id)
        )
    )
    assert [
        (event.attempt, event.event_type)
        for event in events
        if event.event_type in {"rep_completed", "completed"}
    ] == [(2, "rep_completed"), (2, "completed")]


def test_duplicate_product_event_key_is_idempotent(
    db: Session, guest_event_analysis
) -> None:
    analysis, _ = guest_event_analysis
    for _ in range(2):
        record_analysis_event(
            db, analysis_id=analysis.id, attempt=0, event_type="analysis_queued"
        )
    db.commit()
    assert (
        db.scalar(
            select(func.count())
            .select_from(AnalysisEvent)
            .where(AnalysisEvent.analysis_id == analysis.id)
        )
        == 1
    )


@pytest.mark.asyncio
async def test_live_stream_waits_for_new_persisted_events(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    analysis_id = uuid.uuid4()
    future = datetime.now(UTC) + timedelta(hours=1)
    batches = iter(
        [
            ([], "queued", "queued", "pending", future),
            (
                [
                    SimpleNamespace(
                        id=1, event_type="processing_started", payload={"attempt": 1}
                    )
                ],
                "running",
                "processing_started",
                "pending",
                future,
            ),
            (
                [SimpleNamespace(id=2, event_type="completed", payload={"attempt": 1})],
                "completed",
                "completed",
                "skipped",
                future,
            ),
            ([], "completed", "completed", "skipped", future),
        ]
    )

    def fake_read(received_id, cursor):
        assert received_id == analysis_id
        assert cursor in {0, 1, 2}
        return next(batches)

    class ConnectedRequest:
        async def is_disconnected(self):
            return False

    async def no_wait(_seconds):
        return None

    monkeypatch.setattr(analysis_stream, "read_progress", fake_read)
    monkeypatch.setattr(analysis_stream.asyncio, "sleep", no_wait)
    output = [
        event
        async for event in analysis_stream.stream_progress(
            ConnectedRequest(), analysis_id, 0
        )
    ]
    assert [event["event"] for event in output] == [
        "state",
        "processing_started",
        "completed",
    ]
    assert [event["id"] for event in output if "id" in event] == ["1", "2"]


@pytest.mark.asyncio
async def test_completed_stream_stays_open_until_explanation_finishes(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    analysis_id = uuid.uuid4()
    future = datetime.now(UTC) + timedelta(hours=1)
    batches = iter(
        [
            ([], "completed", "completed", "pending", future),
            (
                [
                    SimpleNamespace(
                        id=1, event_type="explanation_started", payload={"attempt": 1}
                    )
                ],
                "completed",
                "completed",
                "running",
                future,
            ),
            (
                [
                    SimpleNamespace(
                        id=2, event_type="explanation_ready", payload={"attempt": 1}
                    )
                ],
                "completed",
                "completed",
                "completed",
                future,
            ),
            ([], "completed", "completed", "completed", future),
        ]
    )

    def fake_read(received_id, cursor):
        assert received_id == analysis_id
        assert cursor in {0, 1, 2}
        return next(batches)

    class ConnectedRequest:
        async def is_disconnected(self):
            return False

    async def no_wait(_seconds):
        return None

    monkeypatch.setattr(analysis_stream, "read_progress", fake_read)
    monkeypatch.setattr(analysis_stream.asyncio, "sleep", no_wait)
    output = [
        event
        async for event in analysis_stream.stream_progress(
            ConnectedRequest(), analysis_id, 0
        )
    ]
    assert [event["event"] for event in output] == [
        "state",
        "explanation_started",
        "explanation_ready",
    ]
    assert '"explanation_status":"pending"' in output[0]["data"]
