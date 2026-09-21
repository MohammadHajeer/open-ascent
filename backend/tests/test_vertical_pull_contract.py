import uuid

from app.schemas.analysis import (
    DeterministicAnalysisRead,
    GuestAnalysisReservationRequest,
)
from app.services.analysis import build_request_fingerprint
from app.services.analysis_events import record_analysis_event
from app.services.analysis_explanation import build_explanation_input


class CaptureSession:
    def __init__(self):
        self.statements = []

    def execute(self, statement):
        self.statements.append(statement)


def test_family_mode_fingerprint_is_distinct_and_has_no_target():
    documentation = uuid.uuid4()
    shared = {"safety_documentation_id": documentation, "safety_ack_version": "v1"}
    family = GuestAnalysisReservationRequest(family_key="vertical_pull", **shared)
    specific = GuestAnalysisReservationRequest(movement_id=uuid.uuid4(), **shared)
    assert family.family_mode
    assert not specific.family_mode
    assert build_request_fingerprint(family) != build_request_fingerprint(specific)


def test_rep_event_persists_only_allowlisted_classification_and_target_fields():
    db = CaptureSession()
    record_analysis_event(
        db,
        analysis_id=uuid.uuid4(),
        attempt=2,
        event_type="rep_completed",
        rep_index=3,
        outcome="valid",
        variations={
            "base_movement": "pull_up",
            "grip_width": "wide",
            "pull_height": "high",
            "raw_landmarks": "secret",
        },
        target_match=False,
        target_deviations=[
            {"dimension": "grip_width", "expected": "close", "detected": "wide"}
        ],
    )
    payload = db.statements[0].compile().params["payload"]
    assert payload == {
        "attempt": 2,
        "rep_index": 3,
        "outcome": "valid",
        "classification": {
            "base_movement": "pull_up",
            "grip_width": "wide",
            "pull_height": "high",
        },
        "target_match": False,
        "target_deviations": [
            {"dimension": "grip_width", "expected": "close", "detected": "wide"}
        ],
    }


def test_grounding_includes_only_supported_deterministic_dimensions():
    result = {
        "outcome": "completed",
        "duration_ms": 3000,
        "valid_rep_count": 1,
        "partial_rep_count": 0,
        "uncertain_rep_count": 0,
        "evidence": {
            "total_sampled_frames": 90,
            "usable_pose_frames": 80,
            "usable_pose_ratio": 0.89,
            "hang_confirmed": True,
        },
        "reps": [
            {
                "rep_index": 1,
                "outcome": "valid",
                "start_ms": 100,
                "end_ms": 900,
                "variations": {
                    "base_movement": "pull_up",
                    "grip_width": "close",
                    "pull_height": "uncertain",
                },
                "target_match": True,
                "target_deviations": [],
            }
        ],
    }
    facts = build_explanation_input(
        result_data=result,
        movement_name="Close-Grip Pull-Up",
        safety_data={"notice": "Use a stable bar."},
    )["allowed_evidence_ids"]
    assert "rep:1:grip_width" in facts
    assert "rep:1:pull_height" in facts
    assert "set:uncertain_dimensions" in facts
    assert "rep:1:target_match" in facts
    assert "rep:1:movement" in facts


def test_completed_result_keeps_rep_classification_and_old_records_parse():
    result = {"outcome": "completed", "duration_ms": 1000,
        "valid_rep_count": 1, "partial_rep_count": 0, "uncertain_rep_count": 0,
        "evidence": {"total_sampled_frames": 30, "usable_pose_frames": 30,
                     "usable_pose_ratio": 1, "hang_confirmed": True},
        "reps": [{"rep_index": 1, "outcome": "valid", "start_ms": 100,
                  "end_ms": 900, "variations": {"base_movement": "pull_up",
                    "grip_width": "close", "pull_height": "high"},
                  "target_match": True, "target_deviations": []}]}
    parsed = DeterministicAnalysisRead.model_validate(result)
    assert parsed.reps[0].variations["pull_height"] == "high"
    assert parsed.reps[0].target_match is True
    old = {**result, "reps": [{"rep_index": 1, "outcome": "valid",
                              "start_ms": 100, "end_ms": 900}]}
    assert DeterministicAnalysisRead.model_validate(old).reps[0].target_match is None
