from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class PullUpAnalyzerConfig:
    # ---------------------------------------------------------
    # VIDEO SAMPLING
    # ---------------------------------------------------------

    target_pose_fps: float = 30.0
    max_pose_dimension_px: int = 960

    # ---------------------------------------------------------
    # REP POSITIONS
    # ---------------------------------------------------------

    # Arms are approximately extended.
    bottom_angle_deg: float = 145.0

    # Elbows are strongly flexed.
    top_angle_deg: float = 50.0

    # A meaningful upward attempt that did not reach our full
    # top threshold may later be classified as a partial rep.
    partial_top_angle_deg: float = 90.0

    # ---------------------------------------------------------
    # SMOOTHING / MOTION
    # ---------------------------------------------------------

    # Roughly equivalent to the 5-frame median window from the
    # original ~30 FPS prototype.
    angle_smoothing_seconds: float = 0.17

    # Minimum elbow-angle change needed before we consider the
    # athlete to have left the bottom position.
    motion_angle_delta_deg: float = 4.0

    # A real pull should move the shoulders upward relative to the
    # approximately anchored wrists. This prevents a bar release
    # from looking like the beginning of another rep just because
    # the elbows flex while the athlete drops away from the bar.
    rep_start_body_rise_threshold: float = 0.008

    # ---------------------------------------------------------
    # HANG CONFIRMATION
    # ---------------------------------------------------------

    # Roughly equivalent to the original 15-frame window at
    # ~30 analyzed frames per second.
    hang_confirmation_seconds: float = 0.50

    wrist_stability_threshold: float = 0.025

    body_movement_threshold: float = 0.008

    body_alignment_tolerance: float = 0.15

    # Both wrists moving this far downward from the confirmed anchor
    # is treated as a likely release from the bar.
    wrist_release_distance: float = 0.06

    # Allow a very short landmark/tracking failure without
    # immediately destroying an active rep.
    invalid_position_tolerance_seconds: float = 0.12

    # ---------------------------------------------------------
    # EVIDENCE QUALITY
    # ---------------------------------------------------------

    # Starting value only. We will validate this with real clips.
    min_landmark_visibility: float = 0.50

    # Enough usable pose frames must exist before we trust a
    # zero-rep conclusion.
    min_usable_pose_ratio: float = 0.40

    # Avoid treating a tiny amount of valid tracking as enough
    # evidence for an analysis.
    min_usable_evidence_seconds: float = 1.0


DEFAULT_PULL_UP_CONFIG = PullUpAnalyzerConfig()
