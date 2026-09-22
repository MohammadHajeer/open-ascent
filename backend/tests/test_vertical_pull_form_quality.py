from __future__ import annotations

from dataclasses import asdict, replace

from app.analyzers.common.types import PhaseEvent, RepAnalysis, RepOutcome, RepPhase
from app.analyzers.pull_up.config import PullUpAnalyzerConfig
from app.analyzers.pull_up.form_quality import (
    FormFrameObservation,
    aggregate_set_quality,
    assess_rep_form,
)
from app.services.analysis_explanation import build_explanation_input

CONFIG = PullUpAnalyzerConfig()


def rep(
    index: int = 1,
    *,
    end_ms: int = 1200,
    lowering_ms: int = 600,
    outcome: RepOutcome = RepOutcome.VALID,
) -> RepAnalysis:
    return RepAnalysis(
        rep_index=index,
        outcome=outcome,
        start_ms=0,
        top_ms=500,
        end_ms=end_ms,
        phase_events=[
            PhaseEvent(RepPhase.BOTTOM, 0),
            PhaseEvent(RepPhase.RISING, 200),
            PhaseEvent(RepPhase.TOP, 500),
            PhaseEvent(RepPhase.LOWERING, lowering_ms),
            PhaseEvent(RepPhase.BOTTOM, end_ms),
        ],
        variations={
            "base_movement": "pull_up",
            "grip_width": "standard",
            "pull_height": "standard",
        },
    )


def observations(
    *,
    left_elbow: float = 165,
    right_elbow: float = 165,
    knee: float = 170,
    right_knee: float | None = None,
    hip: float = 170,
    separation: float = 0.9,
    asymmetry: float = 0.1,
    swing: list[float] | None = None,
    lower_available: bool = True,
    end_ms: int = 1200,
    step_ms: int = 100,
) -> list[FormFrameObservation]:
    timestamps = list(range(0, end_ms + 1, step_ms))
    path = swing or [0.02] * len(timestamps)
    if len(path) < len(timestamps):
        path = (path * (len(timestamps) // len(path) + 1))[: len(timestamps)]
    return [
        FormFrameObservation(
            timestamp_ms=timestamp,
            left_elbow_angle_deg=left_elbow,
            right_elbow_angle_deg=right_elbow,
            average_elbow_angle_deg=(left_elbow + right_elbow) / 2,
            lower_body_available=lower_available,
            left_knee_angle_deg=knee if lower_available else None,
            right_knee_angle_deg=(right_knee or knee) if lower_available else None,
            left_hip_angle_deg=hip if lower_available else None,
            right_hip_angle_deg=hip if lower_available else None,
            leg_separation_ratio=separation if lower_available else None,
            lower_body_asymmetry_ratio=asymmetry if lower_available else None,
            hip_horizontal_ratio=path[position] if lower_available else None,
            ankle_horizontal_ratio=path[position] if lower_available else None,
        )
        for position, timestamp in enumerate(timestamps)
    ]


def assess(**kwargs) -> RepAnalysis:
    candidate = kwargs.pop("candidate", rep())
    return assess_rep_form(candidate, observations(**kwargs), config=CONFIG)


def test_clean_strict_pull_up_reports_supported_positive_states() -> None:
    result = assess()
    assert result.technique_findings == []
    assert result.form_quality["bottom_extension"] == "acceptable"
    assert result.form_quality["body_line_control"] == "controlled"
    assert result.form_quality["swing"] == "minimal"


def test_full_bottom_extension_is_acceptable() -> None:
    assert (
        assess(left_elbow=170, right_elbow=168).form_quality["bottom_extension"]
        == "acceptable"
    )


def test_clear_incomplete_bottom_extension_is_reported() -> None:
    result = assess(left_elbow=145, right_elbow=146)
    assert "limited_bottom_extension" in result.technique_findings


def test_small_natural_elbow_flexion_is_not_flagged() -> None:
    result = assess(left_elbow=158, right_elbow=157)
    assert "limited_bottom_extension" not in result.technique_findings


def test_asymmetric_bottom_extension_is_preserved_alongside_limited_rom() -> None:
    result = assess(left_elbow=166, right_elbow=145)
    assert {"limited_bottom_extension", "asymmetric_bottom_extension"} <= set(
        result.technique_findings
    )


def test_meaningful_knee_bend_is_persistent_finding() -> None:
    assert "excessive_knee_bend" in assess(knee=125).technique_findings


def test_minor_knee_movement_is_not_flagged() -> None:
    assert "excessive_knee_bend" not in assess(knee=162).technique_findings


def test_legs_together_are_acceptable() -> None:
    assert assess(separation=1.0).form_quality["leg_separation"] == "acceptable"


def test_obvious_leg_separation_is_reported() -> None:
    assert "leg_separation" in assess(separation=1.9).technique_findings


def test_lower_body_asymmetry_uses_bilateral_evidence() -> None:
    result = assess(knee=170, right_knee=120, asymmetry=0.8)
    assert "lower_body_asymmetry" in result.technique_findings


def test_forward_leg_movement_uses_hip_flexion() -> None:
    assert "forward_leg_movement" in assess(hip=115).technique_findings


def test_meaningful_swing_requires_body_relative_range_and_reversal() -> None:
    result = assess(swing=[0, 0.2, 0.42, 0.15, -0.05, 0.2])
    assert "swing_detected" in result.technique_findings


def test_small_normal_body_motion_is_not_flagged_as_swing() -> None:
    result = assess(swing=[0, 0.02, 0.04, 0.02, 0.01])
    assert result.form_quality["swing"] == "minimal"


def test_controlled_descent_is_distinct_from_speed() -> None:
    result = assess()
    assert result.tempo["descent_control"] == "controlled"


def test_rapid_but_monotonic_descent_is_still_controlled() -> None:
    candidate = rep(end_ms=1000, lowering_ms=500)
    result = assess(candidate=candidate)
    assert result.tempo["descent_control"] == "rapid_controlled"
    assert "uncontrolled_descent" not in result.technique_findings


def test_uncontrolled_drop_needs_abrupt_timing_and_unstable_progression() -> None:
    candidate = rep(end_ms=900, lowering_ms=600)
    own = observations(end_ms=900, step_ms=60)
    angles = [80, 120, 85, 130, 90, 145]
    own = [
        replace(item, average_elbow_angle_deg=angles[(item.timestamp_ms - 600) // 60])
        if item.timestamp_ms >= 600
        else item
        for item in own
    ]
    result = assess_rep_form(candidate, own, config=CONFIG)
    assert result.tempo["descent_control"] == "uncontrolled_abrupt"
    assert "uncontrolled_descent" in result.technique_findings


def test_multiple_simultaneous_findings_are_not_collapsed() -> None:
    result = assess(
        left_elbow=145,
        right_elbow=165,
        knee=120,
        right_knee=165,
        separation=1.9,
        asymmetry=0.8,
        hip=110,
        swing=[0, 0.4, -0.2, 0.5, -0.1],
    )
    assert len(result.technique_findings) >= 6


def test_form_findings_do_not_invalidate_completed_rep() -> None:
    result = assess(knee=110, separation=2.0, swing=[0, 0.5, -0.2, 0.6])
    assert result.outcome == RepOutcome.VALID
    assert result.technique_findings


def test_uncertain_lower_body_landmarks_produce_no_lower_body_findings() -> None:
    result = assess(lower_available=False)
    assert result.form_quality["knee_bend"] == "uncertain"
    assert result.form_quality["swing"] == "uncertain"
    assert result.technique_findings == []


def test_consistent_tempo_is_aggregated_without_a_score() -> None:
    reps = [assess(candidate=rep(index)) for index in range(1, 4)]
    summary = aggregate_set_quality(
        reps, execution_intent="normal_training", config=CONFIG
    )
    assert summary["tempo"]["state"] == "consistent"
    assert "score" not in summary


def test_slow_controlled_tempo_is_aligned_with_selected_intent() -> None:
    reps = [
        assess(candidate=rep(index, end_ms=2400, lowering_ms=1500), end_ms=2400)
        for index in range(1, 4)
    ]
    summary = aggregate_set_quality(
        reps, execution_intent="controlled_tempo", config=CONFIG
    )
    assert summary["tempo"]["intent_alignment"] == "aligned"


def test_explosive_ascent_is_praised_only_with_control() -> None:
    fast = replace(rep(), top_ms=400)
    reps = [assess(candidate=replace(fast, rep_index=index)) for index in range(1, 4)]
    clean = aggregate_set_quality(
        reps, execution_intent="explosive_power", config=CONFIG
    )
    broken_reps = [
        replace(item, technique_findings=["swing_detected"]) for item in reps
    ]
    broken = aggregate_set_quality(
        broken_reps, execution_intent="explosive_power", config=CONFIG
    )
    assert clean["tempo"]["intent_alignment"] == "aligned"
    assert broken["tempo"]["intent_alignment"] == "speed_with_control_breakdown"


def test_set_level_deterioration_requires_repeated_later_evidence() -> None:
    clean = assess(candidate=rep(1))
    later = [
        replace(assess(candidate=rep(index)), technique_findings=["swing_detected"])
        for index in (2, 3, 4)
    ]
    summary = aggregate_set_quality(
        [clean, *later], execution_intent="normal_training", config=CONFIG
    )
    assert "swing_detected" in summary["deterioration_patterns"]


def test_next_set_focus_selects_one_highest_priority_issue() -> None:
    candidate = replace(
        assess(candidate=rep(1)),
        technique_findings=[
            "leg_separation",
            "limited_bottom_extension",
            "substantial_swing",
        ],
    )
    summary = aggregate_set_quality(
        [candidate], execution_intent="technique_check", config=CONFIG
    )
    assert summary["next_set_focus"] == "substantial_swing"


def test_family_variation_mode_does_not_create_target_failure() -> None:
    first = replace(
        assess(candidate=rep(1)),
        variations={
            "base_movement": "pull_up",
            "grip_width": "standard",
            "pull_height": "high",
        },
    )
    second = replace(
        assess(candidate=rep(2)),
        variations={
            "base_movement": "pull_up",
            "grip_width": "wide",
            "pull_height": "standard",
        },
    )
    summary = aggregate_set_quality(
        [first, second], execution_intent="normal_training", config=CONFIG
    )
    assert "target_not_maintained" not in summary["finding_reps"]


def test_explanation_choices_cannot_select_absent_technique_finding() -> None:
    clean = assess()
    result_data = {
        "outcome": "completed",
        "duration_ms": 1000,
        "valid_rep_count": 1,
        "partial_rep_count": 0,
        "uncertain_rep_count": 0,
        "reps": [asdict(clean)],
        "evidence": {
            "total_sampled_frames": 30,
            "usable_pose_frames": 30,
            "usable_pose_ratio": 1.0,
            "hang_confirmed": True,
            "reason_codes": [],
        },
        "execution_intent": "normal_training",
        "set_summary": aggregate_set_quality(
            [clean], execution_intent="normal_training", config=CONFIG
        ),
    }
    source = build_explanation_input(
        result_data=result_data,
        movement_name="Pull-Up",
        safety_data={},
    )
    ids = {item["id"] for item in source["choices"]["findings"]}
    assert "finding:technique:swing_detected" not in ids


def test_mixed_issue_set_keeps_each_rep_evidence() -> None:
    reps = [
        assess(candidate=rep(1)),
        assess(candidate=rep(2), knee=120, separation=1.9),
        assess(candidate=rep(3), knee=120, hip=110, swing=[0, 0.4, -0.2, 0.5]),
    ]
    summary = aggregate_set_quality(
        reps, execution_intent="normal_training", config=CONFIG
    )
    assert summary["finding_reps"]["excessive_knee_bend"] == [2, 3]
    assert summary["finding_reps"]["leg_separation"] == [2]
    assert summary["finding_reps"]["forward_leg_movement"] == [3]
