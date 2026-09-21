"""Conservative, per-rep pose variation evidence (version 2).

Classification never changes the ANA-04 phase tracker or rep validity.
The bar is not detected: concurrent pose wrists provide its approximate line.
"""

from __future__ import annotations

from collections import Counter
from collections.abc import Sequence
from dataclasses import dataclass, replace
from statistics import median

from app.analyzers.common.types import RepAnalysis, RepPhase
from app.analyzers.pull_up.config import PullUpAnalyzerConfig
from app.analyzers.pull_up.measurements import (
    LEFT_HIP,
    LEFT_SHOULDER,
    LEFT_WRIST,
    RIGHT_HIP,
    RIGHT_SHOULDER,
    RIGHT_WRIST,
    PoseLandmark,
    PullUpFrameMeasurement,
)


@dataclass(frozen=True, slots=True)
class VariationObservation:
    timestamp_ms: int
    width: str
    height: str
    width_reason: str
    width_ratio: float | None
    chest_to_wrist_ratio: float | None
    shoulder_mid_y: float
    wrist_mid_y: float
    torso_mid_y: float
    torso_span_y: float | None
    shoulder_span_x: float
    wrist_span_x: float
    face_to_wrist_y: float | None
    minimum_visibility: float


def observe_variation(
    landmarks: Sequence[PoseLandmark],
    measurement: PullUpFrameMeasurement,
    *,
    config: PullUpAnalyzerConfig,
) -> VariationObservation:
    shoulder_span = abs(landmarks[RIGHT_SHOULDER].x - landmarks[LEFT_SHOULDER].x)
    wrist_span = abs(landmarks[RIGHT_WRIST].x - landmarks[LEFT_WRIST].x)
    shoulder_y = (landmarks[LEFT_SHOULDER].y + landmarks[RIGHT_SHOULDER].y) / 2
    wrist_y = (landmarks[LEFT_WRIST].y + landmarks[RIGHT_WRIST].y) / 2
    hip_y = (landmarks[LEFT_HIP].y + landmarks[RIGHT_HIP].y) / 2
    torso_span = hip_y - shoulder_y

    width_ratio = wrist_span / shoulder_span if shoulder_span > 0 else None
    width = "uncertain"
    width_reason = "threshold_gap"
    # Preserve the established width thresholds and evidence gate.
    if shoulder_span > 0.06 and wrist_span > 0.02 and width_ratio is not None:
        if width_ratio <= config.close_wrist_shoulder_ratio:
            width = "close"
        elif width_ratio >= config.wide_wrist_shoulder_ratio:
            width = "wide"
        elif 1.0 <= width_ratio <= 1.4:
            width = "standard"
        if width != "uncertain":
            width_reason = "classified"
    elif shoulder_span <= 0.06:
        width_reason = "shoulder_span_too_small"
    else:
        width_reason = "wrist_span_too_small"

    # Both numerator and denominator use normalized IMAGE Y. Unlike the old
    # vertical-Y / horizontal-X ratio, this does not change with aspect ratio.
    # The upper-chest proxy is a quarter of the projected torso below the
    # shoulder line. Chin clearance alone does not enter this decision.
    chest_ratio = None
    height = "uncertain"
    if torso_span > 0:
        chest_ratio = (
            shoulder_y + config.height_upper_chest_fraction * torso_span - wrist_y
        ) / torso_span
        if chest_ratio <= config.high_chest_bar_ratio_max:
            height = "high"
        elif chest_ratio >= config.standard_chest_bar_ratio_min:
            height = "standard"

    return VariationObservation(
        timestamp_ms=measurement.timestamp_ms,
        width=width,
        height=height,
        width_reason=width_reason,
        width_ratio=width_ratio,
        chest_to_wrist_ratio=chest_ratio,
        shoulder_mid_y=shoulder_y,
        wrist_mid_y=wrist_y,
        torso_mid_y=(shoulder_y + hip_y) / 2,
        torso_span_y=torso_span if torso_span > 0 else None,
        shoulder_span_x=shoulder_span,
        wrist_span_x=wrist_span,
        face_to_wrist_y=measurement.face_to_wrist_y,
        minimum_visibility=measurement.minimum_required_visibility,
    )


def _vote(
    values: list[str],
    *,
    minimum: int,
    majority: float,
    minimum_total_support: float,
) -> str:
    usable = [value for value in values if value != "uncertain"]
    if len(usable) < minimum:
        return "uncertain"
    winner, count = Counter(usable).most_common(1)[0]
    # Uncertain frames are missing evidence, not votes that can be discarded.
    # Keep the classifiable-frame agreement rule, then separately require a
    # clear majority across the full rep so a small classifiable minority
    # cannot become a falsely confident semantic label.
    if (
        count / len(usable) >= majority
        and count / len(values) >= minimum_total_support
    ):
        return winner
    return "uncertain"


def _height_phase(
    rep: RepAnalysis, observations: Sequence[VariationObservation]
) -> list[VariationObservation]:
    if rep.top_ms is None:
        return []
    lowering_ms = next(
        (
            event.timestamp_ms
            for event in rep.phase_events
            if event.phase == RepPhase.LOWERING and event.timestamp_ms >= rep.top_ms
        ),
        rep.end_ms,
    )
    return [
        item
        for item in observations
        if max(rep.start_ms, rep.top_ms - 100) <= item.timestamp_ms < lowering_ms
    ]


def _height_evidence(
    rep: RepAnalysis,
    observations: Sequence[VariationObservation],
    *,
    config: PullUpAnalyzerConfig,
) -> dict:
    """Choose the highest *stable multi-frame* top window, never one extreme frame."""
    phase = _height_phase(rep, observations)
    usable = [
        item
        for item in phase
        if item.chest_to_wrist_ratio is not None
        and item.torso_span_y is not None
        and item.minimum_visibility >= config.min_landmark_visibility
    ]
    if rep.top_ms is None:
        reason = "top_not_confirmed"
    elif len(usable) < config.min_rep_height_samples:
        reason = "too_few_top_pose_frames"
    else:
        reason = "no_stable_peak_window"

    candidates: list[dict] = []
    unstable_score_windows = 0
    unstable_torso_windows = 0
    if len(usable) >= config.min_rep_height_samples:
        windows = [
            [
                item
                for item in usable
                if start.timestamp_ms
                <= item.timestamp_ms
                <= start.timestamp_ms + config.height_peak_window_ms
            ]
            for start in usable
        ]
        largest = max(map(len, windows), default=0)
        required = min(config.height_peak_window_preferred_samples, largest)
        required = max(config.min_rep_height_samples, required)
        for window in windows:
            if len(window) < required:
                continue
            torso = median(item.torso_span_y for item in window)
            camera_space_wrist_drift = (
                max(item.wrist_mid_y for item in window)
                - min(item.wrist_mid_y for item in window)
            ) / torso
            scores = [item.chest_to_wrist_ratio for item in window]
            score = median(scores)
            score_mad = median(abs(value - score) for value in scores)
            torso_spread = (
                max(item.torso_span_y for item in window)
                - min(item.torso_span_y for item in window)
            ) / torso
            if score_mad > config.height_max_chest_score_mad:
                unstable_score_windows += 1
            if torso_spread > config.height_max_torso_span_spread_ratio:
                unstable_torso_windows += 1
            if (
                score_mad > config.height_max_chest_score_mad
                or torso_spread > config.height_max_torso_span_spread_ratio
            ):
                continue
            candidates.append(
                {
                    "start_ms": window[0].timestamp_ms,
                    "end_ms": window[-1].timestamp_ms,
                    "samples": len(window),
                    "score": score,
                    "score_mad": score_mad,
                    # Diagnostic only: absolute image-space motion is not a
                    # quality gate because camera translation moves the whole
                    # athlete and inferred bar together.
                    "camera_space_wrist_drift_torso_ratio": (
                        camera_space_wrist_drift
                    ),
                    "torso_span_spread_ratio": torso_spread,
                }
            )

    selected = min(candidates, key=lambda item: item["score"]) if candidates else None
    decision = "uncertain"
    if selected is not None:
        if selected["score"] <= config.high_chest_bar_ratio_max:
            decision, reason = "high", "upper_chest_at_bar"
        elif selected["score"] >= config.standard_chest_bar_ratio_min:
            decision, reason = "standard", "upper_chest_below_bar"
        else:
            reason = "between_height_thresholds"

    return {
        "decision": decision,
        "reason": reason,
        "phase_frames": len(phase),
        "usable_frames": len(usable),
        "stable_windows": len(candidates),
        "unstable_score_windows": unstable_score_windows,
        "unstable_torso_windows": unstable_torso_windows,
        "selected_window": selected,
    }


def add_pose_variations(
    rep: RepAnalysis,
    observations: Sequence[VariationObservation],
    *,
    config: PullUpAnalyzerConfig,
) -> RepAnalysis:
    own = [
        item for item in observations if rep.start_ms <= item.timestamp_ms <= rep.end_ms
    ]
    height = _height_evidence(rep, own, config=config)
    return replace(
        rep,
        variations={
            **rep.variations,
            "base_movement": rep.variations.get("movement", "uncertain"),
            "grip_width": _vote(
                [item.width for item in own],
                minimum=config.min_rep_width_samples,
                majority=config.width_majority_ratio,
                minimum_total_support=config.width_min_total_support_ratio,
            ),
            "pull_height": height["decision"],
        },
    )


def build_variation_diagnostic(
    rep: RepAnalysis,
    observations: Sequence[VariationObservation],
    *,
    config: PullUpAnalyzerConfig,
) -> dict:
    """Private CLI-only evidence; never stored in results or SSE."""
    own = [
        item for item in observations if rep.start_ms <= item.timestamp_ms <= rep.end_ms
    ]
    phase = _height_phase(rep, own)
    height = _height_evidence(rep, own, config=config)
    width_votes = Counter(item.width for item in own)
    width_frame_reasons = Counter(item.width_reason for item in own)
    usable_width = sum(
        count for label, count in width_votes.items() if label != "uncertain"
    )
    if usable_width < config.min_rep_width_samples:
        width_reason = "too_few_classifiable_frames"
    elif rep.variations.get("grip_width") == "uncertain":
        width_reason = "insufficient_overall_support"
    else:
        width_reason = "majority_supported"

    def summary(items: list[VariationObservation], field: str) -> dict:
        values = [
            value for item in items if (value := getattr(item, field)) is not None
        ]
        return {
            "count": len(values),
            "min": min(values) if values else None,
            "median": median(values) if values else None,
            "max": max(values) if values else None,
        }

    return {
        "rep_index": rep.rep_index,
        "outcome": rep.outcome.value,
        "start_ms": rep.start_ms,
        "top_ms": rep.top_ms,
        "end_ms": rep.end_ms,
        "bar_reference": "pose_wrist_midpoint_not_direct_bar_detection",
        "width": {
            "decision": rep.variations.get("grip_width"),
            "reason": width_reason,
            "votes": dict(width_votes),
            "frame_reasons": dict(width_frame_reasons),
            "ratio": summary(own, "width_ratio"),
            "shoulder_span_x": summary(own, "shoulder_span_x"),
            "wrist_span_x": summary(own, "wrist_span_x"),
            "thresholds": {
                "close_max": config.close_wrist_shoulder_ratio,
                "standard_min": 1.0,
                "standard_max": 1.4,
                "wide_min": config.wide_wrist_shoulder_ratio,
                "minimum_votes": config.min_rep_width_samples,
                "majority": config.width_majority_ratio,
                "minimum_total_support": config.width_min_total_support_ratio,
            },
        },
        "height": {
            **height,
            "window": "first_TOP_to_LOWERING_with_100ms_lead",
            "chest_to_wrist_ratio": summary(phase, "chest_to_wrist_ratio"),
            "wrist_mid_y": summary(phase, "wrist_mid_y"),
            "shoulder_mid_y": summary(phase, "shoulder_mid_y"),
            "torso_mid_y": summary(phase, "torso_mid_y"),
            "torso_span_y": summary(phase, "torso_span_y"),
            "minimum_visibility": summary(phase, "minimum_visibility"),
            "face_to_wrist_y_for_reference_only": summary(phase, "face_to_wrist_y"),
            "thresholds": {
                "high_max": config.high_chest_bar_ratio_max,
                "standard_min": config.standard_chest_bar_ratio_min,
                "upper_chest_torso_fraction": config.height_upper_chest_fraction,
                "peak_window_ms": config.height_peak_window_ms,
                "minimum_samples": config.min_rep_height_samples,
                "preferred_samples": config.height_peak_window_preferred_samples,
                "max_chest_score_mad": config.height_max_chest_score_mad,
                "max_torso_span_spread_ratio": config.height_max_torso_span_spread_ratio,
            },
        },
        "top_phase_samples": [
            {
                "ms": item.timestamp_ms,
                "chest_to_wrist_ratio": item.chest_to_wrist_ratio,
                "width_ratio": item.width_ratio,
                "wrist_y": item.wrist_mid_y,
                "shoulder_y": item.shoulder_mid_y,
                "torso_y": item.torso_mid_y,
                "torso_span_y": item.torso_span_y,
                "face_to_wrist_y": item.face_to_wrist_y,
                "visibility": item.minimum_visibility,
            }
            for item in phase
        ],
    }
