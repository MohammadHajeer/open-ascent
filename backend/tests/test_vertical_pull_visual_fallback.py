from __future__ import annotations

import uuid
from contextlib import contextmanager
from pathlib import Path
from types import SimpleNamespace

import pytest
from pydantic import ValidationError

from app.analyzers.common.types import PhaseEvent, RepAnalysis, RepOutcome, RepPhase
from app.analyzers.pull_up.targets import compare_rep
from app.schemas.analysis import DeterministicAnalysisRead
from app.services import vertical_pull_visual_classifier as visual_classifier
from app.services.vertical_pull_visual_classifier import (
    VisualClassifierCall,
    VisualRepResult,
    classify_rep_visual,
    fuse_visual_classification,
    representative_timestamps_ms,
    response_format_for,
    unresolved_visual_dimensions,
)
from app.workers import vertical_pull_processor


def make_rep(
    *,
    base_movement: str = "pull_up",
    grip_width: str = "standard",
    pull_height: str = "standard",
    outcome: RepOutcome = RepOutcome.VALID,
) -> RepAnalysis:
    return RepAnalysis(
        rep_index=1,
        outcome=outcome,
        start_ms=1000,
        end_ms=2000,
        top_ms=1500,
        phase_events=[PhaseEvent(RepPhase.TOP, 1500)],
        reason_codes=["fixture_reason"],
        variations={
            "base_movement": base_movement,
            "grip_width": grip_width,
            "pull_height": pull_height,
        },
    )


def visual_result(**classifications: tuple[str, str]) -> VisualRepResult:
    return VisualRepResult.model_validate(
        {
            "rep_index": 1,
            "classifications": {
                dimension: {
                    "value": value,
                    "confidence": confidence,
                    "evidence": ["Visible in the supplied frames."],
                }
                for dimension, (value, confidence) in classifications.items()
            },
        }
    )


def install_visual_runtime(
    monkeypatch: pytest.MonkeyPatch,
    *,
    returned: VisualRepResult,
    cached: VisualRepResult | None = None,
) -> list[tuple[str, ...]]:
    calls: list[tuple[str, ...]] = []

    @contextmanager
    def fake_session():
        yield object()

    monkeypatch.setattr(vertical_pull_processor, "SessionLocal", fake_session)
    monkeypatch.setattr(
        vertical_pull_processor.settings, "openai_visual_classifier_enabled", True
    )
    monkeypatch.setattr(
        vertical_pull_processor,
        "load_cached_visual_result",
        lambda db, **kwargs: cached,
    )
    monkeypatch.setattr(
        vertical_pull_processor,
        "extract_representative_frames",
        lambda video_path, rep: ["frame-1", "frame-2", "frame-3"],
    )

    def classify(**kwargs):
        calls.append(kwargs["dimensions"])
        return VisualClassifierCall(result=returned, usage={"input_tokens": 10})

    monkeypatch.setattr(vertical_pull_processor, "classify_rep_visual", classify)
    monkeypatch.setattr(
        vertical_pull_processor, "persist_visual_success", lambda db, **kwargs: None
    )
    return calls


def test_fully_confident_rep_makes_zero_visual_calls(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    rep = make_rep()
    monkeypatch.setattr(
        vertical_pull_processor,
        "extract_representative_frames",
        lambda *args, **kwargs: pytest.fail("frames must not be extracted"),
    )
    fused, provenance = vertical_pull_processor._apply_visual_fallback(
        Path("unused.mp4"), rep, uuid.uuid4()
    )
    assert fused == rep
    assert all(item["source"] == "deterministic" for item in provenance.values())


@pytest.mark.parametrize(
    "rep,returned,expected_dimensions",
    [
        (
            make_rep(grip_width="uncertain", pull_height="high"),
            visual_result(grip_width=("standard", "high")),
            ("grip_width",),
        ),
        (
            make_rep(grip_width="uncertain", pull_height="uncertain"),
            visual_result(
                grip_width=("standard", "high"),
                pull_height=("high", "high"),
            ),
            ("grip_width", "pull_height"),
        ),
    ],
)
def test_one_call_per_rep_contains_only_unresolved_dimensions(
    monkeypatch: pytest.MonkeyPatch,
    rep: RepAnalysis,
    returned: VisualRepResult,
    expected_dimensions: tuple[str, ...],
) -> None:
    calls = install_visual_runtime(monkeypatch, returned=returned)
    fused, _ = vertical_pull_processor._apply_visual_fallback(
        Path("unused.mp4"), rep, uuid.uuid4()
    )
    assert calls == [expected_dimensions]
    assert unresolved_visual_dimensions(rep) == expected_dimensions
    assert fused.variations["grip_width"] == "standard"


def test_single_visual_call_can_request_all_semantic_dimensions(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    rep = make_rep(
        base_movement="uncertain",
        grip_width="uncertain",
        pull_height="uncertain",
        outcome=RepOutcome.UNCERTAIN,
    )
    returned = visual_result(
        base_movement=("pull_up", "high"),
        grip_width=("wide", "high"),
        pull_height=("high", "high"),
    )
    calls = install_visual_runtime(monkeypatch, returned=returned)

    fused, _ = vertical_pull_processor._apply_visual_fallback(
        Path("unused.mp4"), rep, uuid.uuid4()
    )

    assert calls == [("base_movement", "grip_width", "pull_height")]
    assert fused.variations == {
        "base_movement": "pull_up",
        "grip_width": "wide",
        "pull_height": "high",
    }
    assert fused.outcome == RepOutcome.UNCERTAIN


def test_openai_request_is_neutral_strict_and_uses_transient_images(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured = {}

    class FakeResponses:
        def parse(self, **kwargs):
            captured.update(kwargs)
            parsed = kwargs["text_format"].model_validate(
                {
                    "rep_index": 1,
                    "classifications": {
                        "grip_width": {
                            "value": "standard",
                            "confidence": "high",
                            "evidence": ["Hands appear shoulder-width apart."],
                        }
                    },
                }
            )
            return SimpleNamespace(output_parsed=parsed, usage=None)

    class FakeOpenAI:
        def __init__(self, **kwargs):
            assert kwargs["api_key"] == visual_classifier.settings.openai_api_key
            self.responses = FakeResponses()

    monkeypatch.setattr(visual_classifier, "OpenAI", FakeOpenAI)
    call = classify_rep_visual(
        rep_index=1,
        dimensions=("grip_width",),
        image_data_urls=["data:image/jpeg;base64,AA"] * 3,
    )
    assert call.result.classifications["grip_width"].value == "standard"
    assert captured["model"] == visual_classifier.settings.openai_visual_classifier_model
    assert captured["store"] is False
    assert captured["reasoning"] == {"effort": "none"}
    user_content = captured["input"][1]["content"]
    assert [item["type"] for item in user_content] == [
        "input_text",
        "input_image",
        "input_image",
        "input_image",
    ]
    prompt = user_content[0]["text"]
    assert '"unresolved_dimensions":["grip_width"]' in prompt
    assert "selected target" not in prompt.casefold()
    assert "pull_height:" not in prompt
    schema = captured["text_format"].model_json_schema()
    classifications_ref = schema["properties"]["classifications"]["$ref"]
    definition = schema["$defs"][classifications_ref.rsplit("/", 1)[-1]]
    assert set(definition["properties"]) == {"grip_width"}
    assert definition["additionalProperties"] is False


def test_structured_schema_rejects_unrequested_dimensions() -> None:
    response_format = response_format_for(("grip_width",))
    with pytest.raises(ValidationError):
        response_format.model_validate(
            {
                "rep_index": 1,
                "classifications": {
                    "grip_width": {
                        "value": "standard",
                        "confidence": "high",
                        "evidence": ["Visible."],
                    },
                    "pull_height": {
                        "value": "high",
                        "confidence": "high",
                        "evidence": ["Visible."],
                    },
                },
            }
        )


@pytest.mark.parametrize("confidence", ["medium", "low"])
def test_non_high_visual_confidence_does_not_resolve_uncertainty(
    confidence: str,
) -> None:
    rep = make_rep(grip_width="uncertain")
    fused, provenance = fuse_visual_classification(
        rep, visual_result(grip_width=("standard", confidence))
    )
    assert fused.variations["grip_width"] == "uncertain"
    assert provenance["grip_width"]["source"] == "unresolved"


@pytest.mark.parametrize("value", ["pull_up", "chin_up"])
def test_high_confidence_visual_base_movement_resolves_uncertainty(
    value: str,
) -> None:
    rep = make_rep(base_movement="uncertain", outcome=RepOutcome.UNCERTAIN)
    fused, provenance = fuse_visual_classification(
        rep, visual_result(base_movement=(value, "high"))
    )
    assert fused.variations["base_movement"] == value
    assert fused.outcome == RepOutcome.UNCERTAIN
    assert provenance["base_movement"]["source"] == "visual_fallback"


@pytest.mark.parametrize("confidence", ["medium", "low"])
def test_non_high_visual_base_movement_remains_uncertain(confidence: str) -> None:
    rep = make_rep(base_movement="uncertain")
    fused, provenance = fuse_visual_classification(
        rep, visual_result(base_movement=("pull_up", confidence))
    )
    assert fused.variations["base_movement"] == "uncertain"
    assert provenance["base_movement"]["source"] == "unresolved"


def test_visual_uncertain_does_not_resolve_deterministic_uncertainty() -> None:
    rep = make_rep(grip_width="uncertain")
    fused, _ = fuse_visual_classification(
        rep, visual_result(grip_width=("uncertain", "high"))
    )
    assert fused.variations["grip_width"] == "uncertain"


def test_visual_uncertain_base_movement_remains_uncertain() -> None:
    rep = make_rep(base_movement="uncertain")
    fused, _ = fuse_visual_classification(
        rep, visual_result(base_movement=("uncertain", "high"))
    )
    assert fused.variations["base_movement"] == "uncertain"


def test_visual_cannot_override_confident_deterministic_value() -> None:
    rep = make_rep(grip_width="close")
    fused, provenance = fuse_visual_classification(
        rep, visual_result(grip_width=("wide", "high"))
    )
    assert fused.variations["grip_width"] == "close"
    assert provenance["grip_width"]["source"] == "deterministic"


def test_confident_base_movement_is_not_requested_or_overridden(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    rep = make_rep(base_movement="pull_up", grip_width="uncertain")
    returned = visual_result(grip_width=("standard", "high"))
    calls = install_visual_runtime(monkeypatch, returned=returned)

    fused, provenance = vertical_pull_processor._apply_visual_fallback(
        Path("unused.mp4"), rep, uuid.uuid4()
    )

    assert calls == [("grip_width",)]
    assert fused.variations["base_movement"] == "pull_up"
    assert provenance["base_movement"]["source"] == "deterministic"


def test_fusion_never_changes_mechanical_rep_fields() -> None:
    rep = make_rep(grip_width="uncertain", outcome=RepOutcome.UNCERTAIN)
    fused, _ = fuse_visual_classification(
        rep, visual_result(grip_width=("standard", "high"))
    )
    assert fused.outcome == RepOutcome.UNCERTAIN
    assert fused.start_ms == rep.start_ms
    assert fused.end_ms == rep.end_ms
    assert fused.top_ms == rep.top_ms
    assert fused.phase_events == rep.phase_events
    assert fused.reason_codes == rep.reason_codes


def test_target_comparison_runs_on_fused_values_and_family_mode_has_no_target() -> None:
    rep = make_rep(grip_width="uncertain")
    fused, _ = fuse_visual_classification(
        rep, visual_result(grip_width=("close", "high"))
    )
    assert compare_rep(fused, "close-grip-pull-up").target_match is True
    family_mode = compare_rep(fused, None)
    assert family_mode.target_match is None
    assert family_mode.target_deviations == []


def test_uncertain_attempt_can_match_target_after_base_movement_fusion() -> None:
    rep = make_rep(
        base_movement="uncertain",
        pull_height="high",
        outcome=RepOutcome.UNCERTAIN,
    )
    fused, _ = fuse_visual_classification(
        rep, visual_result(base_movement=("pull_up", "high"))
    )
    compared = compare_rep(fused, "high-pull-up")
    assert compared.target_match is True
    assert compared.outcome == RepOutcome.UNCERTAIN


@pytest.mark.parametrize("error", [TimeoutError("timeout"), ValueError("malformed")])
def test_visual_failure_keeps_deterministic_result(
    monkeypatch: pytest.MonkeyPatch,
    error: Exception,
) -> None:
    rep = make_rep(grip_width="uncertain")
    install_visual_runtime(
        monkeypatch, returned=visual_result(grip_width=("standard", "high"))
    )

    def fail(**kwargs):
        raise error

    monkeypatch.setattr(vertical_pull_processor, "classify_rep_visual", fail)
    fused, provenance = vertical_pull_processor._apply_visual_fallback(
        Path("unused.mp4"), rep, uuid.uuid4()
    )
    assert fused == rep
    assert provenance["grip_width"]["source"] == "unresolved"


def test_successful_cached_result_prevents_duplicate_provider_call(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    rep = make_rep(grip_width="uncertain")
    returned = visual_result(grip_width=("standard", "high"))
    state = {"cached": None, "calls": 0, "extractions": 0}
    analysis_id = uuid.uuid4()

    @contextmanager
    def fake_session():
        yield object()

    monkeypatch.setattr(vertical_pull_processor, "SessionLocal", fake_session)
    monkeypatch.setattr(
        vertical_pull_processor.settings, "openai_visual_classifier_enabled", True
    )
    monkeypatch.setattr(
        vertical_pull_processor,
        "load_cached_visual_result",
        lambda db, **kwargs: state["cached"],
    )

    def extract(video_path, received_rep):
        state["extractions"] += 1
        return ["frame-1", "frame-2", "frame-3"]

    def classify(**kwargs):
        state["calls"] += 1
        return VisualClassifierCall(result=returned, usage={})

    def persist(db, **kwargs):
        state["cached"] = kwargs["call"].result

    monkeypatch.setattr(vertical_pull_processor, "extract_representative_frames", extract)
    monkeypatch.setattr(vertical_pull_processor, "classify_rep_visual", classify)
    monkeypatch.setattr(vertical_pull_processor, "persist_visual_success", persist)

    first, _ = vertical_pull_processor._apply_visual_fallback(
        Path("unused.mp4"), rep, analysis_id
    )
    second, _ = vertical_pull_processor._apply_visual_fallback(
        Path("unused.mp4"), rep, analysis_id
    )
    assert first.variations["grip_width"] == "standard"
    assert second.variations["grip_width"] == "standard"
    assert state["calls"] == 1
    assert state["extractions"] == 1


def test_representative_frames_are_bounded_and_compact() -> None:
    timestamps = representative_timestamps_ms(make_rep())
    assert timestamps == [1300, 1400, 1500, 1600, 1700]
    assert all(1000 <= value <= 2000 for value in timestamps)


def test_public_result_drops_private_visual_provenance() -> None:
    raw = {
        "outcome": "completed",
        "duration_ms": 1000,
        "valid_rep_count": 1,
        "partial_rep_count": 0,
        "uncertain_rep_count": 0,
        "reps": [
            {
                "rep_index": 1,
                "outcome": "valid",
                "start_ms": 100,
                "end_ms": 900,
                "variations": {
                    "base_movement": "pull_up",
                    "grip_width": "standard",
                    "pull_height": "high",
                },
                "_classification_provenance": {
                    "grip_width": {
                        "source": "visual_fallback",
                        "private_frame": "data:image/jpeg;base64,secret",
                    }
                },
            }
        ],
        "evidence": {
            "total_sampled_frames": 30,
            "usable_pose_frames": 30,
            "usable_pose_ratio": 1.0,
            "hang_confirmed": True,
        },
    }
    public = DeterministicAnalysisRead.model_validate(raw).model_dump()
    assert "_classification_provenance" not in public["reps"][0]
    assert "base64" not in str(public)
