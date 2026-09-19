from __future__ import annotations

import uuid
from collections.abc import Generator
from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.guest_credentials import hash_guest_token
from app.models.analysis import Analysis
from app.models.movement import Movement
from app.models.movement_documentation import MovementDocumentation


@pytest.fixture
def guest_result_analysis(db: Session) -> Generator[tuple[Analysis, str], None, None]:
    suffix = uuid.uuid4().hex[:8]
    movement = Movement(
        slug=f"result-test-{suffix}",
        name="Result test",
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
        content={
            "notice": "Use a stable bar.",
            "difficulty": "intermediate",
            "stressed_areas": ["shoulders"],
            "prerequisites": ["Secure grip"],
            "cautions": ["Use control"],
            "stop_conditions": ["Sharp pain"],
            "easier_option": "Use assistance.",
        },
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
        status="completed",
        stage="completed",
        video_path="private/source.mp4",
        guest_token_hash=hash_guest_token(credential, settings.guest_token_secret),
        guest_rate_key="result-test",
        reservation_operation_key=str(uuid.uuid4()),
        request_fingerprint=uuid.uuid4().hex,
        reservation_expires_at=now + timedelta(minutes=15),
        access_expires_at=now + timedelta(hours=1),
        purge_after=now + timedelta(days=1),
        result=make_result("completed"),
    )
    db.add(analysis)
    db.commit()
    db.refresh(analysis)
    yield analysis, credential
    db.execute(delete(Analysis).where(Analysis.id == analysis.id))
    db.execute(
        delete(MovementDocumentation).where(
            MovementDocumentation.id == documentation.id
        )
    )
    db.execute(delete(Movement).where(Movement.id == movement.id))
    db.commit()


def make_result(outcome: str) -> dict:
    return {
        "outcome": outcome,
        "duration_ms": 12000,
        "valid_rep_count": 1 if outcome == "completed" else 0,
        "partial_rep_count": 0 if outcome == "completed" else 1,
        "uncertain_rep_count": 0,
        "reps": [
            {
                "rep_index": 1,
                "outcome": "valid" if outcome == "completed" else "partial",
                "start_ms": 1000,
                "end_ms": 3000,
                "top_ms": 2000,
                "phase_events": [{"phase": "top", "timestamp_ms": 2000}],
                "reason_codes": [] if outcome == "completed" else ["did_not_reach_top"],
                "variations": {"movement": "pull_up", "grip_orientation": "pronated"},
                "internal_only": "must not leak",
            }
        ],
        "evidence": {
            "total_sampled_frames": 100,
            "usable_pose_frames": 80,
            "usable_pose_ratio": 0.8,
            "hang_confirmed": True,
            "reason_codes": []
            if outcome != "insufficient_evidence"
            else ["low_usable_pose_ratio"],
        },
        "private_debug": "must not leak",
    }


def result_url(analysis: Analysis) -> str:
    return f"/analyses/{analysis.id}/result"


def test_guest_config_exposes_backend_limits(client: TestClient) -> None:
    response = client.get("/analyses/guest/config")
    assert response.status_code == 200
    assert response.json()["allowed_content_types"] == ["video/mp4"]
    assert (
        response.json()["max_size_bytes"]
        == settings.guest_video_max_size_mb * 1024 * 1024
    )
    assert (
        response.json()["max_duration_seconds"]
        == settings.guest_video_max_duration_seconds
    )


def test_guest_result_requires_credential(
    client: TestClient, guest_result_analysis
) -> None:
    analysis, _ = guest_result_analysis
    assert client.get(result_url(analysis)).status_code == 401
    assert (
        client.get(
            result_url(analysis), headers={"Authorization": "Bearer wrong"}
        ).status_code
        == 401
    )


def test_completed_result_is_shaped_and_authorized(
    client: TestClient, guest_result_analysis
) -> None:
    analysis, credential = guest_result_analysis
    response = client.get(
        result_url(analysis), headers={"Authorization": f"Bearer {credential}"}
    )
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "completed"
    assert body["result"]["valid_rep_count"] == 1
    assert body["result"]["reps"][0]["variations"]["movement"] == "pull_up"
    assert body["movement"]["safety"]["stop_conditions"] == ["Sharp pain"]
    assert "private_debug" not in body["result"]
    assert "internal_only" not in body["result"]["reps"][0]
    assert "video_path" not in body
    assert "claim_token" not in body


@pytest.mark.parametrize("outcome", ["zero_valid_reps", "insufficient_evidence"])
def test_nonvalid_outcomes_are_results(
    client: TestClient, db: Session, guest_result_analysis, outcome: str
) -> None:
    analysis, credential = guest_result_analysis
    analysis.result = make_result(outcome)
    db.commit()
    response = client.get(
        result_url(analysis), headers={"Authorization": f"Bearer {credential}"}
    )
    assert response.status_code == 200
    assert response.json()["result"]["outcome"] == outcome
    assert response.json()["result"]["valid_rep_count"] == 0


def test_failed_analysis_has_no_result_or_internal_error(
    client: TestClient, db: Session, guest_result_analysis
) -> None:
    analysis, credential = guest_result_analysis
    analysis.status = "failed"
    analysis.stage = "failed"
    analysis.error_code = "processing_error"
    db.commit()
    response = client.get(
        result_url(analysis), headers={"Authorization": f"Bearer {credential}"}
    )
    assert response.status_code == 200
    assert response.json()["status"] == "failed"
    assert response.json()["result"] is None
    assert "processing_error" not in response.text
