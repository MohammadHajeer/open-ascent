from __future__ import annotations

import uuid
from collections.abc import Generator
from contextlib import contextmanager
from datetime import UTC, datetime, timedelta

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
from app.services.analysis_explanation import (
    SELECTION_INSTRUCTIONS,
    build_explanation_input,
    generate_explanation,
    render_selection,
    response_format_for,
    validate_explanation,
)
from app.services.explanation_jobs import (
    MAX_EXPLANATION_ATTEMPTS,
    ExplanationClaimLostError,
    claim_next_explanation,
    complete_explanation,
    fail_explanation,
)
from app.workers import explanation_worker


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
    assert response.json()["max_size_bytes"] == 10 * 1024 * 1024
    assert response.json()["max_duration_seconds"] == 20


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


def grounded_candidate() -> dict:
    return {
        "summary": {
            "text": "The analyzer confirmed a completed attempt.",
            "evidence": ["rep:1:outcome"],
        },
        "key_findings": [],
        "next_set_focus": {
            "text": "Keep the same controlled setup.",
            "evidence": ["safety:caution:1"],
        },
        "safety_note": {"text": "Sharp pain", "evidence": ["safety:stop:1"]},
    }


def explanation_source() -> dict:
    return build_explanation_input(
        result_data=make_result("completed"),
        movement_name="Pull-up",
        safety_data={"cautions": ["Use control"], "stop_conditions": ["Sharp pain"]},
    )


def selection_candidate(source: dict) -> dict:
    return {
        "summary_id": source["choices"]["summary"][0]["id"],
        "finding_ids": [source["choices"]["findings"][0]["id"]],
        "focus_id": source["choices"]["focus"][0]["id"],
        "safety_id": source["choices"]["safety"][0]["id"],
    }


def test_provider_receives_only_explicit_deterministic_facts(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    source = explanation_source()
    assert source["counts"]["valid"] == 1
    assert any(fact["id"] == "rep:1:outcome" for fact in source["facts"])
    assert "private_debug" not in str(source)
    assert "internal_only" not in str(source)
    assert "landmarks" not in str(source)
    assert "private/source.mp4" not in str(source)

    captured = {}

    class FakeResponses:
        def parse(self, **kwargs):
            captured.update(kwargs)
            parsed = kwargs["text_format"].model_validate(selection_candidate(source))
            return type("Response", (), {"output_parsed": parsed})()

    class FakeOpenAI:
        def __init__(self, **kwargs):
            assert "api_key" in kwargs
            self.responses = FakeResponses()

    monkeypatch.setattr("app.services.analysis_explanation.OpenAI", FakeOpenAI)
    generated = generate_explanation(source)
    assert 1 <= len(generated.summary.evidence) <= 4
    assert set(generated.summary.evidence) <= set(source["allowed_evidence_ids"])
    assert generated.safety_note is not None
    assert generated.safety_note.text == "Sharp pain"
    format_schema = captured["text_format"].model_json_schema()
    for category in ("summary", "findings", "focus", "safety"):
        expected_ids = [choice["id"] for choice in source["choices"][category]]
        assert (
            format_schema["$defs"][f"{category.capitalize()}ChoiceId"]["enum"]
            == expected_ids
        )
    assert format_schema["properties"]["finding_ids"]["maxItems"] == 4
    assert format_schema["properties"]["finding_ids"]["minItems"] == 1
    assert "return ONLY choice IDs" in SELECTION_INSTRUCTIONS
    assert "not a detected variation" in SELECTION_INSTRUCTIONS
    assert "meaningful partial or uncertain attempts" in SELECTION_INSTRUCTIONS
    assert '"allowed_evidence_ids"' in captured["input"][1]["content"]
    assert '"choices"' in captured["input"][1]["content"]
    assert "private_debug" not in captured["input"][1]["content"]
    assert "landmarks" not in captured["input"][1]["content"]


def test_structured_schema_rejects_ids_not_in_exact_input() -> None:
    source = explanation_source()
    response_format = response_format_for(source)
    with pytest.raises(ValueError):
        response_format.model_validate(
            selection_candidate(source) | {"finding_ids": ["finding:invented"]}
        )
    with pytest.raises(ValueError):
        response_format.model_validate(
            selection_candidate(source)
            | {"finding_ids": [source["choices"]["findings"][0]["id"]] * 5}
        )
    with pytest.raises(ValueError, match="do not match supplied facts"):
        response_format_for(source | {"allowed_evidence_ids": ["outcome"]})


def test_backend_renders_only_catalog_text_and_rejects_duplicate_choices() -> None:
    source = explanation_source()
    selected = selection_candidate(source)
    rendered = render_selection(selected, source)
    assert rendered.summary.text == source["choices"]["summary"][0]["text"]
    assert rendered.key_findings[0].text == source["choices"]["findings"][0]["text"]
    with pytest.raises(ValueError, match="duplicate findings"):
        render_selection(
            selected | {"finding_ids": selected["finding_ids"] * 2}, source
        )
    with pytest.raises(ValueError, match="unsupported choice"):
        render_selection(selected | {"focus_id": "focus:invented"}, source)


def test_clean_set_explanation_is_useful_without_invented_criticism() -> None:
    result = make_result("completed")
    result["reps"] = [result["reps"][0] | {"rep_index": index} for index in range(1, 5)]
    result["valid_rep_count"] = 4
    source = build_explanation_input(
        result_data=result,
        movement_name="Pull-up",
        safety_data={"cautions": ["Use control"], "stop_conditions": ["Sharp pain"]},
    )
    assert [item["id"] for item in source["choices"]["findings"]] == [
        "finding:consistent_completion"
    ]
    assert [item["id"] for item in source["choices"]["focus"]] == [
        "focus:no_specific_adjustment"
    ]
    explanation = render_selection(
        {
            "summary_id": "summary:outcome",
            "finding_ids": ["finding:consistent_completion"],
            "focus_id": "focus:no_specific_adjustment",
            "safety_id": "safety:none",
        },
        source,
    )
    assert "mechanically confirmed" in explanation.summary.text
    assert "consistent" in explanation.key_findings[0].text
    assert "No specific technique adjustment" in explanation.next_set_focus.text
    assert explanation.next_set_focus.evidence == ["outcome"]
    assert not any(
        term in str(source["choices"]).lower()
        for term in ("pull-up movement", "starting hang", "review the published")
    )


def test_partial_rep_explanation_names_specific_grounded_cause_and_focus() -> None:
    result = make_result("completed")
    valid = result["reps"][0]
    result["reps"] = [valid | {"rep_index": index} for index in range(1, 4)] + [
        valid
        | {
            "rep_index": 4,
            "outcome": "partial",
            "reason_codes": ["did_not_reach_top"],
        }
    ]
    result["valid_rep_count"] = 3
    result["partial_rep_count"] = 1
    source = build_explanation_input(
        result_data=result, movement_name="Pull-up", safety_data={}
    )
    assert [item["id"] for item in source["choices"]["findings"]] == [
        "finding:rep:4:outcome"
    ]
    explanation = render_selection(
        {
            "summary_id": "summary:outcome",
            "finding_ids": ["finding:rep:4:outcome"],
            "focus_id": "focus:partial:did_not_reach_top",
            "safety_id": "safety:none",
        },
        source,
    )
    assert "partial attempts" in explanation.summary.text
    assert "fourth attempt was partial" in explanation.key_findings[0].text
    assert "before the required top position" in explanation.key_findings[0].text
    assert explanation.key_findings[0].evidence == [
        "rep:4:outcome",
        "rep:4:reason:did_not_reach_top",
    ]
    assert "before lowering" in explanation.next_set_focus.text
    assert explanation.next_set_focus.evidence == explanation.key_findings[0].evidence


def test_uncertain_rep_explains_evidence_limit_without_bad_form_claim() -> None:
    result = make_result("completed")
    valid = result["reps"][0]
    result["reps"].append(
        valid
        | {
            "rep_index": 2,
            "outcome": "uncertain",
            "reason_codes": ["tracking_lost"],
        }
    )
    result["uncertain_rep_count"] = 1
    source = build_explanation_input(
        result_data=result, movement_name="Pull-up", safety_data={}
    )
    explanation = render_selection(
        {
            "summary_id": "summary:outcome",
            "finding_ids": ["finding:rep:2:outcome"],
            "focus_id": "focus:uncertain:tracking_lost",
            "safety_id": "safety:none",
        },
        source,
    )
    assert "uncertain attempts" in explanation.summary.text
    assert "body tracking was interrupted" in explanation.key_findings[0].text
    assert "bad form" not in str(explanation).lower()
    assert explanation.key_findings[0].evidence == [
        "rep:2:outcome",
        "rep:2:reason:tracking_lost",
    ]
    assert explanation.next_set_focus.evidence == explanation.key_findings[0].evidence


def test_fused_semantics_remain_resolved_when_mechanics_are_uncertain() -> None:
    result = make_result("completed")
    template = result["reps"][0]
    result.update(
        {
            "outcome": "zero_valid_reps",
            "valid_rep_count": 0,
            "partial_rep_count": 0,
            "uncertain_rep_count": 2,
            "reps": [
                template
                | {
                    "rep_index": index,
                    "outcome": "uncertain",
                    "reason_codes": ["low_landmark_confidence"],
                    "variations": {
                        "movement": "pull_up",
                        "base_movement": "pull_up",
                        "grip_orientation": "pronated",
                        "grip_width": "standard",
                        "pull_height": "high",
                    },
                    "target_match": True,
                }
                for index in (1, 2)
            ],
        }
    )
    source = build_explanation_input(
        result_data=result,
        movement_name="High Pull-Up",
        safety_data={},
    )

    assert source["counts"] == {
        "confirmed": 0,
        "valid": 0,
        "partial": 0,
        "uncertain": 2,
        "total": 2,
    }
    assert all(
        attempt["mechanical_outcome"] == "uncertain"
        and attempt["base_movement"] == "pull_up"
        and attempt["grip_width"] == "standard"
        and attempt["pull_height"] == "high"
        and attempt["target_relation"] == "matches"
        for attempt in source["attempts"]
    )
    assert source["set_patterns"] == {
        "semantic_variation": False,
        "base_movement": "pull_up",
        "grip_width": "standard",
        "pull_height": "high",
        "grip_consistent": True,
        "pull_height_consistent": True,
        "all_attempts_match_target": True,
        "uncertain_dimensions": [],
    }
    assert (
        "High Pull-Ups with a standard grip" in source["choices"]["summary"][0]["text"]
    )
    assert "matched the selected target" in source["choices"]["summary"][0]["text"]
    assert "mechanically confirmed" in source["choices"]["summary"][0]["text"]
    assert "unknown" not in source["choices"]["summary"][0]["text"].lower()
    assert source["uncertainty_note"] is not None
    assert (
        "Movement identity can still be recognized"
        in source["uncertainty_note"]["text"]
    )

    finding_ids = [item["id"] for item in source["choices"]["findings"]]
    assert "finding:set:base_movement" in finding_ids
    assert "finding:set:grip_width" in finding_ids
    assert "finding:set:pull_height" in finding_ids
    assert "finding:set:target_match" in finding_ids
    assert "finding:set:uncertain:low_landmark_confidence" in finding_ids
    assert not any(identifier.startswith("finding:rep:") for identifier in finding_ids)
    assert (
        response_format_for(source).model_json_schema()["properties"]["finding_ids"][
            "minItems"
        ]
        == 2
    )

    explanation = render_selection(
        {
            "summary_id": "summary:outcome",
            "finding_ids": [
                "finding:set:base_movement",
                "finding:set:grip_width",
                "finding:set:pull_height",
                "finding:set:target_match",
            ],
            "focus_id": "focus:uncertain:low_landmark_confidence",
            "safety_id": "safety:none",
        },
        source,
    )
    assert explanation.uncertainty_note is not None
    assert "unknown" not in str(explanation).lower()
    assert "Keep the full body visible" in explanation.next_set_focus.text


def test_no_actionable_finding_uses_explicit_no_adjustment_copy() -> None:
    source = build_explanation_input(
        result_data=make_result("completed"), movement_name="Pull-up", safety_data={}
    )
    focus = source["choices"]["focus"]
    assert focus == [
        {
            "id": "focus:no_specific_adjustment",
            "text": "No specific technique adjustment was identified from this set.",
            "evidence": ["outcome"],
        }
    ]
    assert "maintain" not in focus[0]["text"].lower()


def test_no_unsupported_timing_or_positive_tracking_claim_is_offered() -> None:
    result = make_result("completed")
    result["reps"].append(result["reps"][0] | {"rep_index": 2})
    result["valid_rep_count"] = 2
    result["evidence"]["usable_pose_ratio"] = 0.95
    source = build_explanation_input(
        result_data=result, movement_name="Pull-up", safety_data={}
    )
    offered_text = " ".join(
        option["text"] for category in source["choices"].values() for option in category
    ).lower()
    assert "timing" not in offered_text
    assert "reliable throughout" not in offered_text
    assert "strong tracking" not in offered_text
    assert "hang" not in offered_text
    assert "movement was a pull-up" not in offered_text


def test_limited_evidence_quality_is_explained_only_from_reason_code() -> None:
    result = make_result("insufficient_evidence")
    source = build_explanation_input(
        result_data=result, movement_name="Pull-up", safety_data={}
    )
    explanation = render_selection(
        {
            "summary_id": "summary:outcome",
            "finding_ids": ["finding:evidence:low_usable_pose_ratio"],
            "focus_id": "focus:evidence:low_usable_pose_ratio",
            "safety_id": "safety:none",
        },
        source,
    )
    assert "limited body tracking" in explanation.key_findings[0].text
    assert explanation.key_findings[0].evidence == [
        "evidence:reason:low_usable_pose_ratio"
    ]
    assert explanation.next_set_focus.evidence == explanation.key_findings[0].evidence


@pytest.mark.parametrize(
    ("section", "overflow_id"),
    [
        ("summary", "count:total"),
        ("key_findings[0]", "rep:3:movement"),
    ],
)
def test_real_response_evidence_overflow_is_rejected_and_logged(
    caplog: pytest.LogCaptureFixture, section: str, overflow_id: str
) -> None:
    # The live reproduction supplied five summary references and eight
    # per-rep references. Every ID existed; the per-section cap still applies.
    summary_ids = [
        "outcome",
        "count:valid",
        "count:partial",
        "count:uncertain",
        "count:total",
    ]
    finding_ids = [
        f"rep:{index}:{kind}" for index in range(1, 5) for kind in ("movement", "grip")
    ]
    result_data = make_result("completed")
    result_data["reps"] = [
        result_data["reps"][0] | {"rep_index": index} for index in range(1, 5)
    ]
    result_data["valid_rep_count"] = 4
    source = build_explanation_input(
        result_data=result_data,
        movement_name="Close-Grip Pull-Up",
        safety_data={
            "notice": "Use controlled technique.",
            "prerequisites": ["Secure bar", "Stable hang", "Controlled setup"],
            "cautions": ["Avoid swinging", "Use control", "Lower steadily"],
            "stop_conditions": ["Sharp pain", "Grip loss", "Loss of control"],
            "easier_option": "Use assistance.",
        },
    )
    assert set(summary_ids + finding_ids) <= set(source["allowed_evidence_ids"])
    candidate = {
        "summary": {
            "text": "The set was analyzed.",
            "evidence": summary_ids if section == "summary" else ["outcome"],
        },
        "key_findings": [
            {
                "text": "Movement and grip were recorded.",
                "evidence": finding_ids if section != "summary" else ["rep:1:movement"],
            }
        ],
        "next_set_focus": {"text": "Keep a controlled setup.", "evidence": ["outcome"]},
        "safety_note": None,
    }
    with pytest.raises(ValueError, match="Explanation evidence is out of bounds"):
        validate_explanation(candidate, source)
    assert f"section={section}" in caplog.text
    assert overflow_id in caplog.text
    selected = response_format_for(source).model_validate(selection_candidate(source))
    rendered = render_selection(selected, source)
    assert 1 <= len(rendered.summary.evidence) <= 4
    assert set(rendered.summary.evidence) <= set(source["allowed_evidence_ids"])
    assert 1 <= len(rendered.key_findings[0].evidence) <= 4
    assert set(rendered.key_findings[0].evidence) <= set(source["allowed_evidence_ids"])
    assert rendered.safety_note is not None
    assert rendered.safety_note.evidence == ["safety:stop:1"]


def test_duplicate_evidence_id_is_rejected_and_logged(
    caplog: pytest.LogCaptureFixture,
) -> None:
    candidate = grounded_candidate()
    candidate["summary"]["evidence"] = ["rep:1:outcome", "rep:1:outcome"]
    with pytest.raises(ValueError, match="Explanation evidence is out of bounds"):
        validate_explanation(candidate, explanation_source())
    assert "duplicate_ids=['rep:1:outcome']" in caplog.text


def test_selected_exercise_name_is_grounded_without_detected_variation() -> None:
    source = build_explanation_input(
        result_data=make_result("completed"),
        movement_name="Close-Grip Pull-Up",
        safety_data={"cautions": ["Use control"], "stop_conditions": ["Sharp pain"]},
    )
    candidate = grounded_candidate()
    candidate["summary"] = {
        "text": "Your selected Close-Grip Pull-Up was analyzed.",
        "evidence": ["movement:requested", "outcome"],
    }
    explanation = validate_explanation(candidate, source)
    assert explanation.summary.evidence == ["movement:requested", "outcome"]
    candidate["summary"]["text"] = "The Close-Grip Pull-Up set was analyzed."
    assert validate_explanation(candidate, source).summary.evidence == [
        "movement:requested",
        "outcome",
    ]


@pytest.mark.parametrize(
    ("text", "evidence"),
    [
        ("The analyzer detected a Close-Grip Pull-Up.", ["movement:requested"]),
        ("Your selected Wide-Grip Pull-Up was analyzed.", ["movement:requested"]),
        ("Your selected Close-Grip Pull-Up was analyzed.", ["outcome"]),
    ],
)
def test_variation_claim_without_selected_exercise_grounding_is_rejected(
    caplog: pytest.LogCaptureFixture, text: str, evidence: list[str]
) -> None:
    source = build_explanation_input(
        result_data=make_result("completed"),
        movement_name="Close-Grip Pull-Up",
        safety_data={"cautions": ["Use control"], "stop_conditions": ["Sharp pain"]},
    )
    candidate = grounded_candidate()
    candidate["summary"] = {"text": text, "evidence": evidence}
    with pytest.raises(ValueError, match="unsupported claim"):
        validate_explanation(candidate, source)
    assert "Rejected explanation variation claim: section=summary" in caplog.text


def test_rejected_claim_logs_term_section_and_evidence_ids(
    caplog: pytest.LogCaptureFixture,
) -> None:
    candidate = grounded_candidate()
    candidate["next_set_focus"] = {
        "text": "Keep the next set pain-free.",
        "evidence": ["safety:caution:1"],
    }
    with pytest.raises(ValueError, match="unsupported claim"):
        validate_explanation(candidate, explanation_source())
    assert "section=next_set_focus" in caplog.text
    assert "term='pain'" in caplog.text
    assert "evidence_ids=['safety:caution:1']" in caplog.text


@pytest.mark.parametrize(
    "change",
    [
        {
            "summary": {
                "text": "An extra rep was valid.",
                "evidence": ["rep:99:outcome"],
            }
        },
        {"summary": {"text": "The score was 90.", "evidence": ["rep:1:outcome"]}},
        {
            "next_set_focus": {
                "text": "Ignore pain and continue.",
                "evidence": ["safety:caution:1"],
            }
        },
        {"summary": {"text": "All reps were valid.", "evidence": ["rep:1:outcome"]}},
        {"key_findings": [{"text": "Good.", "evidence": ["rep:1:outcome"]}] * 5},
        {"safety_note": {"text": "Ignore pain.", "evidence": ["safety:stop:1"]}},
        {"extra": "unsupported"},
    ],
)
def test_ungrounded_or_unbounded_output_is_rejected(change: dict) -> None:
    candidate = grounded_candidate() | change
    with pytest.raises(ValueError):
        validate_explanation(candidate, explanation_source())


def test_explanation_worker_persists_separately_and_reconnects_without_regeneration(
    client: TestClient,
    db: Session,
    guest_result_analysis,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    analysis, credential = guest_result_analysis

    @contextmanager
    def same_session():
        yield db

    monkeypatch.setattr(explanation_worker, "SessionLocal", same_session)
    monkeypatch.setattr(analysis_stream, "SessionLocal", same_session)
    calls = []

    def fake_generate(source):
        calls.append(source)
        return validate_explanation(grounded_candidate(), source)

    monkeypatch.setattr(explanation_worker, "generate_explanation", fake_generate)
    assert explanation_worker.process_one_explanation() is True
    assert explanation_worker.process_one_explanation() is False
    db.refresh(analysis)
    assert analysis.status == "completed"
    assert analysis.result["valid_rep_count"] == 1
    assert analysis.ai_feedback_status == "completed"
    assert analysis.ai_feedback_attempts == 1
    assert len(calls) == 1
    response = client.get(
        result_url(analysis), headers={"Authorization": f"Bearer {credential}"}
    )
    assert response.status_code == 200
    assert (
        response.json()["explanation"]["summary"]["text"]
        == grounded_candidate()["summary"]["text"]
    )
    assert response.json()["result"]["valid_rep_count"] == 1
    events = list(
        db.scalars(
            select(AnalysisEvent)
            .where(AnalysisEvent.analysis_id == analysis.id)
            .order_by(AnalysisEvent.id)
        )
    )
    assert [event.event_type for event in events] == [
        "explanation_started",
        "explanation_ready",
    ]
    replay = client.get(
        f"/analyses/{analysis.id}/events",
        headers={
            "Authorization": f"Bearer {credential}",
            "Last-Event-ID": str(events[0].id),
        },
    )
    assert "event: explanation_ready" in replay.text
    assert "event: explanation_started" not in replay.text
    assert grounded_candidate()["summary"]["text"] not in replay.text
    assert (
        db.scalar(
            select(func.count())
            .select_from(AnalysisEvent)
            .where(AnalysisEvent.analysis_id == analysis.id)
        )
        == 2
    )


@pytest.mark.parametrize(
    "provider_error", [TimeoutError("timeout"), ValueError("ungrounded output")]
)
def test_explanation_failure_preserves_deterministic_result(
    client: TestClient,
    db: Session,
    guest_result_analysis,
    monkeypatch: pytest.MonkeyPatch,
    provider_error: Exception,
) -> None:
    analysis, credential = guest_result_analysis

    @contextmanager
    def same_session():
        yield db

    monkeypatch.setattr(explanation_worker, "SessionLocal", same_session)
    monkeypatch.setattr(analysis_stream, "SessionLocal", same_session)

    def fail_provider(_source):
        raise provider_error

    monkeypatch.setattr(explanation_worker, "generate_explanation", fail_provider)
    assert explanation_worker.process_one_explanation() is True
    db.refresh(analysis)
    assert analysis.status == "completed"
    assert analysis.ai_feedback_status == "failed"
    body = client.get(
        result_url(analysis), headers={"Authorization": f"Bearer {credential}"}
    ).json()
    assert body["result"]["valid_rep_count"] == 1
    assert body["movement"]["safety"]["stop_conditions"] == ["Sharp pain"]
    assert body["explanation_status"] == "failed"
    assert body["explanation"] is None
    assert body["explanation_retry_available"] is True
    stream = client.get(
        f"/analyses/{analysis.id}/events",
        headers={"Authorization": f"Bearer {credential}"},
    )
    assert "event: explanation_started" in stream.text
    assert "event: explanation_failed" in stream.text
    assert str(provider_error) not in stream.text


def test_guest_retry_only_requeues_explanation_and_reuses_events(
    client: TestClient, db: Session, guest_result_analysis
) -> None:
    analysis, credential = guest_result_analysis
    original_result = analysis.result.copy()
    original_video_path = analysis.video_path
    first = claim_next_explanation(db)
    assert first is not None
    fail_explanation(db, first)

    endpoint = f"/analyses/{analysis.id}/explanation/retry"
    assert client.post(endpoint).status_code == 401
    assert (
        client.post(endpoint, headers={"Authorization": "Bearer wrong"}).status_code
        == 401
    )
    headers = {"Authorization": f"Bearer {credential}"}
    retried = client.post(endpoint, headers=headers)
    assert retried.status_code == 200
    assert retried.json() == {"explanation_status": "pending"}
    duplicate = client.post(endpoint, headers=headers)
    assert duplicate.status_code == 200
    assert duplicate.json() == retried.json()
    db.refresh(analysis)
    assert analysis.ai_feedback_attempts == 1
    assert analysis.status == "completed"
    assert analysis.stage == "completed"
    assert analysis.result == original_result
    assert analysis.video_path == original_video_path
    assert analysis.ai_explanation is None

    second = claim_next_explanation(db)
    assert second is not None and second.attempt == 2
    assert client.post(endpoint, headers=headers).json() == {
        "explanation_status": "running"
    }
    complete_explanation(db, second, grounded_candidate())
    result = client.get(result_url(analysis), headers=headers).json()
    assert result["explanation_status"] == "completed"
    assert result["explanation_retry_available"] is False
    assert result["result"] is not None
    assert (
        result["explanation"]["summary"]["text"]
        == grounded_candidate()["summary"]["text"]
    )
    assert client.post(endpoint, headers=headers).status_code == 409
    events = list(
        db.scalars(
            select(AnalysisEvent)
            .where(AnalysisEvent.analysis_id == analysis.id)
            .order_by(AnalysisEvent.id)
        )
    )
    assert [(event.attempt, event.event_type) for event in events] == [
        (1, "explanation_started"),
        (1, "explanation_failed"),
        (2, "explanation_started"),
        (2, "explanation_ready"),
    ]


def test_explanation_retry_limit_and_refresh_never_queue_work(
    client: TestClient, db: Session, guest_result_analysis
) -> None:
    analysis, credential = guest_result_analysis
    headers = {"Authorization": f"Bearer {credential}"}
    endpoint = f"/analyses/{analysis.id}/explanation/retry"
    for attempt in range(1, MAX_EXPLANATION_ATTEMPTS + 1):
        claim = claim_next_explanation(db)
        assert claim is not None and claim.attempt == attempt
        fail_explanation(db, claim)
        for _ in range(2):
            result = client.get(result_url(analysis), headers=headers).json()
            assert result["result"]["valid_rep_count"] == 1
            assert result["explanation_status"] == "failed"
            assert result["explanation_retry_available"] is (
                attempt < MAX_EXPLANATION_ATTEMPTS
            )
        if attempt < MAX_EXPLANATION_ATTEMPTS:
            assert client.post(endpoint, headers=headers).status_code == 200
    assert client.post(endpoint, headers=headers).status_code == 409
    db.refresh(analysis)
    assert analysis.ai_feedback_attempts == MAX_EXPLANATION_ATTEMPTS
    assert claim_next_explanation(db) is None


def test_expired_final_explanation_claim_becomes_retryable_unavailable(
    client: TestClient, db: Session, guest_result_analysis
) -> None:
    analysis, credential = guest_result_analysis
    endpoint = f"/analyses/{analysis.id}/explanation/retry"
    headers = {"Authorization": f"Bearer {credential}"}
    for attempt in range(1, MAX_EXPLANATION_ATTEMPTS + 1):
        claim = claim_next_explanation(db)
        assert claim is not None and claim.attempt == attempt
        if attempt < MAX_EXPLANATION_ATTEMPTS:
            analysis.ai_feedback_lease_expires_at = datetime.now(UTC) - timedelta(
                minutes=1
            )
            db.commit()
    analysis.ai_feedback_lease_expires_at = datetime.now(UTC) - timedelta(minutes=1)
    db.commit()
    assert claim_next_explanation(db) is None
    db.refresh(analysis)
    assert analysis.status == "completed"
    assert analysis.ai_feedback_status == "failed"
    assert analysis.ai_feedback_attempts == MAX_EXPLANATION_ATTEMPTS
    assert (
        client.get(result_url(analysis), headers=headers).json()[
            "explanation_retry_available"
        ]
        is False
    )
    assert client.post(endpoint, headers=headers).status_code == 409
    events = list(
        db.scalars(
            select(AnalysisEvent)
            .where(AnalysisEvent.analysis_id == analysis.id)
            .order_by(AnalysisEvent.id)
        )
    )
    assert [(event.attempt, event.event_type) for event in events][-2:] == [
        (MAX_EXPLANATION_ATTEMPTS, "explanation_started"),
        (MAX_EXPLANATION_ATTEMPTS, "explanation_failed"),
    ]


def test_expired_explanation_claim_cannot_overwrite_newer_attempt(
    db: Session, guest_result_analysis
) -> None:
    analysis, _ = guest_result_analysis
    old = claim_next_explanation(db)
    assert old is not None and old.analysis_id == analysis.id
    analysis.ai_feedback_lease_expires_at = datetime.now(UTC) - timedelta(minutes=1)
    db.commit()
    new = claim_next_explanation(db)
    assert new is not None and new.attempt == 2
    with pytest.raises(ExplanationClaimLostError):
        complete_explanation(db, old, grounded_candidate())
    complete_explanation(db, new, grounded_candidate())
    db.refresh(analysis)
    assert analysis.ai_feedback_status == "completed"
    assert analysis.ai_feedback_attempts == 2
