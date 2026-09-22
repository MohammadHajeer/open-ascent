"""Deterministic Vertical Pull form-quality evidence.

This module is intentionally downstream of the rep phase tracker. It annotates
attempts that the existing state machine has already classified and therefore
cannot turn an imperfect completed repetition into an invalid one.
"""

from __future__ import annotations

import math
from collections.abc import Callable, Sequence
from dataclasses import dataclass, replace
from itertools import pairwise
from statistics import mean, median, pstdev
from typing import Any

from app.analyzers.common.geometry import calculate_angle
from app.analyzers.common.types import RepAnalysis, RepPhase
from app.analyzers.pull_up.config import PullUpAnalyzerConfig
from app.analyzers.pull_up.measurements import (
    LEFT_ANKLE,
    LEFT_HIP,
    LEFT_KNEE,
    LEFT_SHOULDER,
    RIGHT_ANKLE,
    RIGHT_HIP,
    RIGHT_KNEE,
    RIGHT_SHOULDER,
    PoseLandmark,
    PullUpFrameMeasurement,
)

EXECUTION_INTENTS = {
    "normal_training",
    "explosive_power",
    "controlled_tempo",
    "max_test",
    "technique_check",
}


@dataclass(frozen=True, slots=True)
class FormFrameObservation:
    timestamp_ms: int
    left_elbow_angle_deg: float
    right_elbow_angle_deg: float
    average_elbow_angle_deg: float
    lower_body_available: bool
    left_knee_angle_deg: float | None = None
    right_knee_angle_deg: float | None = None
    left_hip_angle_deg: float | None = None
    right_hip_angle_deg: float | None = None
    leg_separation_ratio: float | None = None
    lower_body_asymmetry_ratio: float | None = None
    hip_horizontal_ratio: float | None = None
    ankle_horizontal_ratio: float | None = None


def _distance(a: PoseLandmark, b: PoseLandmark) -> float:
    return math.hypot(a.x - b.x, a.y - b.y)


def observe_form_quality(
    landmarks: Sequence[PoseLandmark],
    measurement: PullUpFrameMeasurement,
    *,
    config: PullUpAnalyzerConfig,
) -> FormFrameObservation:
    lower_indexes = (
        LEFT_HIP,
        RIGHT_HIP,
        LEFT_KNEE,
        RIGHT_KNEE,
        LEFT_ANKLE,
        RIGHT_ANKLE,
    )
    lower_available = len(landmarks) > max(lower_indexes) and all(
        landmarks[index].visibility >= config.min_landmark_visibility
        for index in lower_indexes
    )
    base = {
        "timestamp_ms": measurement.timestamp_ms,
        "left_elbow_angle_deg": measurement.left_elbow_angle_deg,
        "right_elbow_angle_deg": measurement.right_elbow_angle_deg,
        "average_elbow_angle_deg": measurement.average_elbow_angle_deg,
        "lower_body_available": lower_available,
    }
    if not lower_available:
        return FormFrameObservation(**base)

    left_shoulder = landmarks[LEFT_SHOULDER]
    right_shoulder = landmarks[RIGHT_SHOULDER]
    left_hip = landmarks[LEFT_HIP]
    right_hip = landmarks[RIGHT_HIP]
    left_knee = landmarks[LEFT_KNEE]
    right_knee = landmarks[RIGHT_KNEE]
    left_ankle = landmarks[LEFT_ANKLE]
    right_ankle = landmarks[RIGHT_ANKLE]

    shoulder_mid_x = (left_shoulder.x + right_shoulder.x) / 2
    shoulder_mid_y = (left_shoulder.y + right_shoulder.y) / 2
    hip_mid_x = (left_hip.x + right_hip.x) / 2
    hip_mid_y = (left_hip.y + right_hip.y) / 2
    ankle_mid_x = (left_ankle.x + right_ankle.x) / 2
    torso_scale = math.hypot(hip_mid_x - shoulder_mid_x, hip_mid_y - shoulder_mid_y)
    shoulder_width = _distance(left_shoulder, right_shoulder)
    hip_width = _distance(left_hip, right_hip)
    separation_scale = max(hip_width, shoulder_width * 0.45, torso_scale * 0.30)
    if torso_scale <= 0.04 or separation_scale <= 0.02:
        return FormFrameObservation(**{**base, "lower_body_available": False})

    left_knee_angle = calculate_angle(left_hip, left_knee, left_ankle)
    right_knee_angle = calculate_angle(right_hip, right_knee, right_ankle)
    left_hip_angle = calculate_angle(left_shoulder, left_hip, left_knee)
    right_hip_angle = calculate_angle(right_shoulder, right_hip, right_knee)
    if None in {
        left_knee_angle,
        right_knee_angle,
        left_hip_angle,
        right_hip_angle,
    }:
        return FormFrameObservation(**{**base, "lower_body_available": False})

    knee_span = _distance(left_knee, right_knee)
    ankle_span = _distance(left_ankle, right_ankle)
    left_out = _distance(left_ankle, left_hip) / torso_scale
    right_out = _distance(right_ankle, right_hip) / torso_scale
    return FormFrameObservation(
        **base,
        left_knee_angle_deg=left_knee_angle,
        right_knee_angle_deg=right_knee_angle,
        left_hip_angle_deg=left_hip_angle,
        right_hip_angle_deg=right_hip_angle,
        leg_separation_ratio=max(knee_span, ankle_span) / separation_scale,
        lower_body_asymmetry_ratio=abs(left_out - right_out),
        hip_horizontal_ratio=(hip_mid_x - shoulder_mid_x) / torso_scale,
        ankle_horizontal_ratio=(ankle_mid_x - hip_mid_x) / torso_scale,
    )


def _state(
    values: list[float],
    *,
    issue: Callable[[float], bool],
    acceptable: Callable[[float], bool],
    config: PullUpAnalyzerConfig,
) -> str:
    if len(values) < config.form_min_samples:
        return "uncertain"
    issue_fraction = sum(issue(value) for value in values) / len(values)
    acceptable_fraction = sum(acceptable(value) for value in values) / len(values)
    if issue_fraction >= config.form_persistence_ratio:
        return "issue"
    if acceptable_fraction >= 1 - config.form_persistence_ratio:
        return "acceptable"
    return "uncertain"


def _direction_reversals(values: list[float], deadband: float) -> int:
    signs: list[int] = []
    for previous, current in pairwise(values):
        delta = current - previous
        if abs(delta) >= deadband:
            signs.append(1 if delta > 0 else -1)
    return sum(left != right for left, right in pairwise(signs))


def _tempo(
    rep: RepAnalysis, own: list[FormFrameObservation], config: PullUpAnalyzerConfig
) -> dict[str, Any]:
    lowering_ms = next(
        (
            event.timestamp_ms
            for event in rep.phase_events
            if event.phase == RepPhase.LOWERING
            and rep.top_ms is not None
            and event.timestamp_ms >= rep.top_ms
        ),
        None,
    )
    ascent_ms = rep.top_ms - rep.start_ms if rep.top_ms is not None else None
    top_transition_ms = (
        lowering_ms - rep.top_ms
        if lowering_ms is not None and rep.top_ms is not None
        else None
    )
    descent_ms = rep.end_ms - lowering_ms if lowering_ms is not None else None
    descent = [
        item
        for item in own
        if lowering_ms is not None and item.timestamp_ms >= lowering_ms
    ]
    progress = [item.average_elbow_angle_deg for item in descent]
    monotonic_ratio = None
    if len(progress) >= 3:
        monotonic_ratio = sum(
            current >= previous - 3 for previous, current in pairwise(progress)
        ) / (len(progress) - 1)
    control = "uncertain"
    if descent_ms is not None and monotonic_ratio is not None:
        if (
            descent_ms <= config.abrupt_descent_ms
            and monotonic_ratio <= config.uncontrolled_descent_max_monotonic_ratio
        ):
            control = "uncontrolled_abrupt"
        elif monotonic_ratio < config.controlled_descent_min_monotonic_ratio:
            control = "inconsistent"
        elif descent_ms < config.rapid_descent_ms:
            control = "rapid_controlled"
        else:
            control = "controlled"
    return {
        "ascent_ms": ascent_ms,
        "top_transition_ms": top_transition_ms,
        "descent_ms": descent_ms,
        "total_ms": rep.end_ms - rep.start_ms,
        "descent_control": control,
        "descent_monotonic_ratio": (
            round(monotonic_ratio, 3) if monotonic_ratio is not None else None
        ),
    }


def assess_rep_form(
    rep: RepAnalysis,
    observations: Sequence[FormFrameObservation],
    *,
    config: PullUpAnalyzerConfig,
) -> RepAnalysis:
    own = [
        item for item in observations if rep.start_ms <= item.timestamp_ms <= rep.end_ms
    ]
    bottom = [
        item
        for item in own
        if item.timestamp_ms <= rep.start_ms + config.bottom_quality_window_ms
        or item.timestamp_ms >= rep.end_ms - config.bottom_quality_window_ms
        if item.average_elbow_angle_deg >= config.bottom_angle_deg - 5
    ]
    bottom_left = [item.left_elbow_angle_deg for item in bottom]
    bottom_right = [item.right_elbow_angle_deg for item in bottom]
    extension = "uncertain"
    asymmetry = "uncertain"
    if len(bottom) >= config.form_min_samples:
        left = median(bottom_left)
        right = median(bottom_right)
        stable = (
            max(bottom_left) - min(bottom_left) <= config.bottom_extension_max_range_deg
            and max(bottom_right) - min(bottom_right)
            <= config.bottom_extension_max_range_deg
        )
        if stable:
            if min(left, right) < config.bottom_extension_limited_deg:
                extension = "limited"
            elif min(left, right) >= config.bottom_extension_good_deg:
                extension = "acceptable"
            asymmetry = (
                "asymmetric"
                if abs(left - right) >= config.bottom_extension_asymmetry_deg
                else "symmetric"
            )

    lower = [item for item in own if item.lower_body_available]
    left_knees = [
        item.left_knee_angle_deg
        for item in lower
        if item.left_knee_angle_deg is not None
    ]
    right_knees = [
        item.right_knee_angle_deg
        for item in lower
        if item.right_knee_angle_deg is not None
    ]
    knee_values = [
        min(left, right) for left, right in zip(left_knees, right_knees, strict=False)
    ]
    knee_bend = _state(
        knee_values,
        issue=lambda value: value <= config.knee_bend_excessive_deg,
        acceptable=lambda value: value >= config.knee_bend_acceptable_deg,
        config=config,
    )
    separations = [
        item.leg_separation_ratio
        for item in lower
        if item.leg_separation_ratio is not None
    ]
    leg_separation = _state(
        separations,
        issue=lambda value: value >= config.leg_separation_issue_ratio,
        acceptable=lambda value: value <= config.leg_separation_acceptable_ratio,
        config=config,
    )
    knee_differences = [
        abs(left - right) for left, right in zip(left_knees, right_knees, strict=False)
    ]
    asymmetry_values = [
        max(
            knee / config.knee_asymmetry_deg,
            item.lower_body_asymmetry_ratio / config.lower_body_asymmetry_ratio,
        )
        for knee, item in zip(knee_differences, lower, strict=False)
        if item.lower_body_asymmetry_ratio is not None
    ]
    lower_asymmetry = _state(
        asymmetry_values,
        issue=lambda value: value >= 1,
        acceptable=lambda value: value <= 0.65,
        config=config,
    )
    hip_angles = [
        min(item.left_hip_angle_deg, item.right_hip_angle_deg)
        for item in lower
        if item.left_hip_angle_deg is not None and item.right_hip_angle_deg is not None
    ]
    forward_movement = _state(
        hip_angles,
        issue=lambda value: value <= config.forward_leg_issue_deg,
        acceptable=lambda value: value >= config.forward_leg_acceptable_deg,
        config=config,
    )

    hip_path = [
        item.hip_horizontal_ratio
        for item in lower
        if item.hip_horizontal_ratio is not None
    ]
    ankle_path = [
        item.ankle_horizontal_ratio
        for item in lower
        if item.ankle_horizontal_ratio is not None
    ]
    swing = "uncertain"
    swing_range = None
    reversals = 0
    if (
        len(hip_path) >= config.form_min_samples
        and len(ankle_path) >= config.form_min_samples
    ):
        hip_range = max(hip_path) - min(hip_path)
        ankle_range = max(ankle_path) - min(ankle_path)
        swing_range = max(hip_range, ankle_range)
        reversals = max(
            _direction_reversals(hip_path, config.swing_delta_deadband_ratio),
            _direction_reversals(ankle_path, config.swing_delta_deadband_ratio),
        )
        if swing_range >= config.swing_substantial_ratio and reversals >= 1:
            swing = "substantial"
        elif swing_range >= config.swing_meaningful_ratio and reversals >= 1:
            swing = "meaningful"
        elif swing_range < config.swing_meaningful_ratio:
            swing = "minimal"

    body_line = "uncertain"
    known_lower = [knee_bend, leg_separation, lower_asymmetry, forward_movement, swing]
    if any(value in {"issue", "meaningful", "substantial"} for value in known_lower):
        body_line = "breakdown"
    elif all(value not in {"uncertain"} for value in known_lower):
        body_line = "controlled"

    tempo = _tempo(rep, own, config)
    findings: list[str] = []
    if extension == "limited":
        findings.append("limited_bottom_extension")
    if asymmetry == "asymmetric":
        findings.append("asymmetric_bottom_extension")
    if knee_bend == "issue":
        findings.append("excessive_knee_bend")
    if leg_separation == "issue":
        findings.append("leg_separation")
    if lower_asymmetry == "issue":
        findings.append("lower_body_asymmetry")
    if forward_movement == "issue":
        findings.append("forward_leg_movement")
    if swing == "meaningful":
        findings.append("swing_detected")
    elif swing == "substantial":
        findings.append("substantial_swing")
    if tempo["descent_control"] == "uncontrolled_abrupt":
        findings.append("uncontrolled_descent")
    elif tempo["descent_control"] == "inconsistent":
        findings.append("inconsistent_descent")

    quality = {
        "bottom_extension": extension,
        "bottom_extension_symmetry": asymmetry,
        "knee_bend": knee_bend,
        "leg_separation": leg_separation,
        "lower_body_asymmetry": lower_asymmetry,
        "forward_leg_movement": forward_movement,
        "swing": swing,
        "body_line_control": body_line,
        "lower_body_usable_frames": len(lower),
        "rep_pose_frames": len(own),
        "swing_range_torso_ratio": round(swing_range, 3)
        if swing_range is not None
        else None,
        "swing_direction_reversals": reversals if swing != "uncertain" else None,
    }
    return replace(rep, form_quality=quality, technique_findings=findings, tempo=tempo)


FOCUS_PRIORITY = (
    "uncontrolled_descent",
    "substantial_swing",
    "swing_detected",
    "limited_bottom_extension",
    "asymmetric_bottom_extension",
    "lower_body_asymmetry",
    "forward_leg_movement",
    "leg_separation",
    "excessive_knee_bend",
    "target_not_maintained",
    "inconsistent_descent",
    "tempo_inconsistent",
)


def aggregate_set_quality(
    reps: Sequence[RepAnalysis],
    *,
    execution_intent: str,
    config: PullUpAnalyzerConfig,
) -> dict[str, Any]:
    intent = (
        execution_intent if execution_intent in EXECUTION_INTENTS else "normal_training"
    )
    finding_reps: dict[str, list[int]] = {}
    for rep in reps:
        for finding in rep.technique_findings:
            finding_reps.setdefault(finding, []).append(rep.rep_index)

    valid = [rep for rep in reps if rep.outcome.value == "valid"]
    positive_patterns: list[str] = []
    evaluable = [rep for rep in valid if rep.form_quality]
    if valid and len(valid) == len(reps):
        positive_patterns.append("all_repetitions_completed")
    if evaluable and all(
        rep.form_quality.get("bottom_extension") == "acceptable" for rep in evaluable
    ):
        positive_patterns.append("bottom_extension_maintained")
    if evaluable and all(
        rep.form_quality.get("swing") == "minimal" for rep in evaluable
    ):
        positive_patterns.append("minimal_swing")
    if evaluable and all(
        rep.form_quality.get("body_line_control") == "controlled" for rep in evaluable
    ):
        positive_patterns.append("stable_body_line")
    if evaluable and all(
        rep.tempo.get("descent_control") in {"controlled", "rapid_controlled"}
        for rep in evaluable
    ):
        positive_patterns.append("descent_controlled")

    totals = [
        rep.tempo.get("total_ms")
        for rep in valid
        if rep.tempo.get("total_ms") is not None
    ]
    ascent = [
        rep.tempo.get("ascent_ms")
        for rep in valid
        if rep.tempo.get("ascent_ms") is not None
    ]
    descent = [
        rep.tempo.get("descent_ms")
        for rep in valid
        if rep.tempo.get("descent_ms") is not None
    ]
    variability = (
        pstdev(totals) / mean(totals) if len(totals) >= 2 and mean(totals) else None
    )
    tempo_state = "uncertain"
    if len(totals) >= 2:
        tempo_state = (
            "consistent" if variability <= config.tempo_consistency_cv else "variable"
        )
        if tempo_state == "variable":
            finding_reps.setdefault(
                "tempo_inconsistent", [rep.rep_index for rep in valid]
            )

    deterioration: list[str] = []
    if len(reps) >= 3:
        split = len(reps) // 2
        early = reps[:split]
        late = reps[split:]
        for finding in finding_reps:
            early_rate = sum(finding in rep.technique_findings for rep in early) / len(
                early
            )
            late_rate = sum(finding in rep.technique_findings for rep in late) / len(
                late
            )
            if late_rate - early_rate >= 0.5:
                deterioration.append(finding)

    target_values = [rep.target_match for rep in reps if rep.target_match is not None]
    if target_values and not all(target_values):
        finding_reps.setdefault(
            "target_not_maintained",
            [rep.rep_index for rep in reps if rep.target_match is False],
        )
    has_control_breakdown = any(
        finding in finding_reps
        for finding in (
            "substantial_swing",
            "swing_detected",
            "lower_body_asymmetry",
            "forward_leg_movement",
            "leg_separation",
            "uncontrolled_descent",
            "limited_bottom_extension",
            "asymmetric_bottom_extension",
            "excessive_knee_bend",
        )
    )
    average_ascent = round(mean(ascent)) if ascent else None
    intent_alignment = "uncertain"
    if intent == "explosive_power" and average_ascent is not None:
        if (
            average_ascent <= config.explosive_fast_ascent_ms
            and not has_control_breakdown
        ):
            intent_alignment = "aligned"
        elif average_ascent <= config.explosive_fast_ascent_ms:
            intent_alignment = "speed_with_control_breakdown"
    elif intent == "controlled_tempo" and tempo_state != "uncertain":
        intent_alignment = (
            "aligned"
            if tempo_state == "consistent" and not has_control_breakdown
            else "control_inconsistent"
        )
    elif intent == "normal_training" and tempo_state != "uncertain":
        intent_alignment = (
            "rushed_with_control_breakdown"
            if len(totals) >= 2 and totals[-1] < totals[0] * 0.85 and deterioration
            else "neutral"
        )
    elif intent == "max_test" and len(totals) >= 2:
        intent_alignment = (
            "speed_decreased" if totals[-1] > totals[0] * 1.15 else "stable"
        )
    elif intent == "technique_check" and evaluable:
        intent_alignment = (
            "aligned" if not finding_reps else "technique_findings_present"
        )
    focus = next((item for item in FOCUS_PRIORITY if item in finding_reps), None)

    def trend(values: list[int]) -> str:
        if len(values) < 2:
            return "uncertain"
        if values[-1] > values[0] * 1.15:
            return "slower"
        if values[-1] < values[0] * 0.85:
            return "faster"
        return "stable"

    return {
        "execution_intent": intent,
        "finding_reps": finding_reps,
        "positive_patterns": positive_patterns,
        "deterioration_patterns": deterioration,
        "next_set_focus": focus or "maintain_control",
        "tempo": {
            "state": tempo_state,
            "average_total_ms": round(mean(totals)) if totals else None,
            "average_ascent_ms": average_ascent,
            "average_descent_ms": round(mean(descent)) if descent else None,
            "variability_cv": round(variability, 3)
            if variability is not None
            else None,
            "fastest_rep": valid[totals.index(min(totals))].rep_index
            if totals and len(totals) == len(valid)
            else None,
            "slowest_rep": valid[totals.index(max(totals))].rep_index
            if totals and len(totals) == len(valid)
            else None,
            "trend": trend(totals),
            "ascent_trend": trend(ascent),
            "descent_trend": trend(descent),
            "intent_alignment": intent_alignment,
        },
    }
