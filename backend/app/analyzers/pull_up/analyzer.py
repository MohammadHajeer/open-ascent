from __future__ import annotations

import math
from collections import deque
from pathlib import Path
from statistics import median

from app.analyzers.common.types import (
    AnalysisEvidence,
    AnalysisOutcome,
    MovementAnalysisResult,
    RepAnalysis,
)
from app.analyzers.common.video import (
    get_video_metadata,
    iter_pose_video_frames,
)
from app.analyzers.pull_up.config import (
    DEFAULT_PULL_UP_CONFIG,
    PullUpAnalyzerConfig,
)
from app.analyzers.pull_up.evidence import (
    body_is_under_hands,
    build_wrist_history_sample,
    calculate_hang_metrics,
    hands_are_above_shoulders,
)
from app.analyzers.pull_up.measurements import (
    measure_pull_up_frame,
)
from app.analyzers.pull_up.phases import (
    PullUpPhaseTracker,
)

POSE_MODEL_PATH = Path("models/pose_landmarker_full.task")


def analyze_pull_up_video(
    video_path: Path,
    *,
    config: PullUpAnalyzerConfig = DEFAULT_PULL_UP_CONFIG,
    pose_model_path: Path = POSE_MODEL_PATH,
) -> MovementAnalysisResult:
    metadata = get_video_metadata(video_path)

    effective_fps = min(
        metadata.fps,
        config.target_pose_fps,
    )

    hang_required_samples = max(
        1,
        math.ceil(
            config.hang_confirmation_seconds
            * effective_fps
        ),
    )

    smoothing_samples = max(
        1,
        math.ceil(
            config.angle_smoothing_seconds
            * effective_fps
        ),
    )

    invalid_position_tolerance_samples = max(
        1,
        math.ceil(
            config.invalid_position_tolerance_seconds
            * effective_fps
        ),
    )

    minimum_usable_samples = max(
        1,
        math.ceil(
            config.min_usable_evidence_seconds
            * effective_fps
        ),
    )

    angle_history: deque[float] = deque(
        maxlen=smoothing_samples,
    )

    wrist_history = deque(
        maxlen=hang_required_samples,
    )

    tracker = PullUpPhaseTracker(config)

    reps: list[RepAnalysis] = []

    total_sampled_frames = 0
    usable_pose_frames = 0

    hang_confirmed = False
    ever_confirmed_hang = False

    left_wrist_anchor_y: float | None = None
    right_wrist_anchor_y: float | None = None

    invalid_position_frames = 0
    last_timestamp_ms = 0

    for pose_frame in iter_pose_video_frames(
        video_path,
        pose_model_path=pose_model_path,
        target_fps=config.target_pose_fps,
        max_pose_dimension_px=config.max_pose_dimension_px,
    ):
        total_sampled_frames += 1
        last_timestamp_ms = pose_frame.timestamp_ms

        landmarks = pose_frame.landmarks

        # -----------------------------------------------------
        # NO POSE
        # -----------------------------------------------------

        if landmarks is None:
            if hang_confirmed:
                invalid_position_frames += 1

                if (
                    invalid_position_frames
                    > invalid_position_tolerance_samples
                ):
                    uncertain_rep = tracker.interrupt(
                        timestamp_ms=pose_frame.timestamp_ms,
                        reason_code="tracking_lost",
                    )

                    if uncertain_rep is not None:
                        reps.append(uncertain_rep)

                    hang_confirmed = False
                    left_wrist_anchor_y = None
                    right_wrist_anchor_y = None

                    angle_history.clear()
                    wrist_history.clear()

            if not hang_confirmed:
                wrist_history.clear()
                angle_history.clear()

            continue

        # -----------------------------------------------------
        # FRAME MEASUREMENT / VISIBILITY
        # -----------------------------------------------------

        measurement = measure_pull_up_frame(
            landmarks,
            timestamp_ms=pose_frame.timestamp_ms,
            min_visibility=config.min_landmark_visibility,
        )

        if measurement is None:
            if hang_confirmed:
                invalid_position_frames += 1

                if (
                    invalid_position_frames
                    > invalid_position_tolerance_samples
                ):
                    uncertain_rep = tracker.interrupt(
                        timestamp_ms=pose_frame.timestamp_ms,
                        reason_code="low_landmark_confidence",
                    )

                    if uncertain_rep is not None:
                        reps.append(uncertain_rep)

                    hang_confirmed = False
                    left_wrist_anchor_y = None
                    right_wrist_anchor_y = None

                    angle_history.clear()
                    wrist_history.clear()

            if not hang_confirmed:
                wrist_history.clear()
                angle_history.clear()

            continue

        usable_pose_frames += 1

        # -----------------------------------------------------
        # SMOOTH ELBOW ANGLE
        # -----------------------------------------------------

        angle_history.append(
            measurement.average_elbow_angle_deg
        )

        smoothed_angle = float(
            median(angle_history)
        )

        # -----------------------------------------------------
        # STRICT INITIAL HANG EVIDENCE
        # -----------------------------------------------------
        #
        # The strict geometry below is used only to establish that
        # the athlete really started from a plausible bar hang.
        #
        # Once the hang has been confirmed, we deliberately stop
        # requiring "wrists above shoulders" and "body under hands"
        # on every frame. A high pull is expected to leave dead-hang
        # geometry while the athlete is still legitimately on the bar.

        hands_above_shoulders = (
            hands_are_above_shoulders(landmarks)
        )

        body_under_hands = body_is_under_hands(
            landmarks,
            alignment_tolerance=(
                config.body_alignment_tolerance
            ),
        )

        wrist_sample = build_wrist_history_sample(
            landmarks
        )

        if hang_confirmed or hands_above_shoulders and body_under_hands:
            wrist_history.append(wrist_sample)

        else:
            wrist_history.clear()
            angle_history.clear()

        hang_metrics = calculate_hang_metrics(
            wrist_history,
            required_samples=hang_required_samples,
            wrist_stability_threshold=(
                config.wrist_stability_threshold
            ),
        )

        # -----------------------------------------------------
        # CONFIRM A REAL HANG
        # -----------------------------------------------------

        if (
            not hang_confirmed
            and hands_above_shoulders
            and body_under_hands
            and hang_metrics is not None
            and hang_metrics.wrists_stable
            and hang_metrics.body_movement_range
            >= config.body_movement_threshold
        ):
            hang_confirmed = True
            ever_confirmed_hang = True

            left_wrist_anchor_y = float(
                median(
                    sample.left_y
                    for sample in wrist_history
                )
            )

            right_wrist_anchor_y = float(
                median(
                    sample.right_y
                    for sample in wrist_history
                )
            )

            invalid_position_frames = 0

        if not hang_confirmed:
            continue

        # -----------------------------------------------------
        # MAINTAIN THE CONFIRMED BAR SESSION
        # -----------------------------------------------------
        #
        # After initial confirmation, the body is free to move through
        # high-pull geometry. We keep the session alive as long as the
        # required pose remains trustworthy and both wrists have not
        # clearly dropped away from their confirmed bar height.

        wrists_released = False

        if (
            left_wrist_anchor_y is not None
            and right_wrist_anchor_y is not None
        ):
            wrists_released = (
                landmarks[15].y - left_wrist_anchor_y
                > config.wrist_release_distance
                and landmarks[16].y - right_wrist_anchor_y
                > config.wrist_release_distance
            )

        if wrists_released:
            invalid_position_frames += 1

            if (
                invalid_position_frames
                > invalid_position_tolerance_samples
            ):
                uncertain_rep = tracker.interrupt(
                    timestamp_ms=pose_frame.timestamp_ms,
                    reason_code="wrist_release_detected",
                )

                if uncertain_rep is not None:
                    reps.append(uncertain_rep)

                hang_confirmed = False
                left_wrist_anchor_y = None
                right_wrist_anchor_y = None

                angle_history.clear()
                wrist_history.clear()

            continue

        invalid_position_frames = 0

        # -----------------------------------------------------
        # REP STATE MACHINE
        # -----------------------------------------------------
        #
        # Elbow flexion alone is not enough to begin a rep. The phase
        # tracker also receives shoulder motion relative to the wrists,
        # so releasing the bar and bending the elbows while falling does
        # not look like another upward pull. Once a rep is rising, the
        # optional mouth-to-wrist measurement can also confirm a valid
        # wide-grip top even when the elbows never reach the strict
        # standard/close-grip top angle.

        completed_rep = tracker.update(
            timestamp_ms=pose_frame.timestamp_ms,
            angle_deg=smoothed_angle,
            body_relative_y=(
                wrist_sample.shoulder_relative_y
            ),
            face_to_wrist_y=(
                measurement.face_to_wrist_y
            ),
        )

        if completed_rep is not None:
            reps.append(completed_rep)

    # ---------------------------------------------------------
    # VIDEO ENDED DURING AN ACTIVE REP
    # ---------------------------------------------------------

    final_uncertain_rep = tracker.interrupt(
        timestamp_ms=last_timestamp_ms,
        reason_code="video_ended_during_rep",
    )

    if final_uncertain_rep is not None:
        reps.append(final_uncertain_rep)

    # ---------------------------------------------------------
    # EVIDENCE QUALITY
    # ---------------------------------------------------------

    usable_pose_ratio = (
        usable_pose_frames / total_sampled_frames
        if total_sampled_frames
        else 0.0
    )

    evidence_reason_codes: list[str] = []

    if usable_pose_frames < minimum_usable_samples:
        evidence_reason_codes.append(
            "too_few_usable_pose_frames"
        )

    if (
        usable_pose_ratio
        < config.min_usable_pose_ratio
    ):
        evidence_reason_codes.append(
            "low_usable_pose_ratio"
        )

    if not ever_confirmed_hang and not reps:
        evidence_reason_codes.append(
            "pull_up_hang_not_confirmed"
        )

    evidence = AnalysisEvidence(
        total_sampled_frames=total_sampled_frames,
        usable_pose_frames=usable_pose_frames,
        usable_pose_ratio=usable_pose_ratio,
        hang_confirmed=ever_confirmed_hang,
        reason_codes=evidence_reason_codes,
    )

    # ---------------------------------------------------------
    # COUNTS
    # ---------------------------------------------------------

    valid_rep_count = sum(
        rep.outcome.value == "valid"
        for rep in reps
    )

    partial_rep_count = sum(
        rep.outcome.value == "partial"
        for rep in reps
    )

    uncertain_rep_count = sum(
        rep.outcome.value == "uncertain"
        for rep in reps
    )

    # ---------------------------------------------------------
    # OVERALL OUTCOME
    # ---------------------------------------------------------

    insufficient_evidence = (
        usable_pose_frames < minimum_usable_samples
        or usable_pose_ratio
        < config.min_usable_pose_ratio
        or (
            not ever_confirmed_hang
            and not reps
        )
    )

    if insufficient_evidence:
        outcome = AnalysisOutcome.INSUFFICIENT_EVIDENCE

    elif valid_rep_count == 0:
        outcome = AnalysisOutcome.ZERO_VALID_REPS

    else:
        outcome = AnalysisOutcome.COMPLETED

    return MovementAnalysisResult(
        outcome=outcome,
        duration_ms=metadata.duration_ms,
        valid_rep_count=valid_rep_count,
        partial_rep_count=partial_rep_count,
        uncertain_rep_count=uncertain_rep_count,
        reps=reps,
        evidence=evidence,
    )
