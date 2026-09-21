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

    # Strong elbow flexion is enough by itself to confirm the top.
    # This remains useful for standard and close-grip reps.
    top_angle_deg: float = 50.0

    # Wide pull-ups can reach a legitimate top while keeping the
    # elbows much more open. In that case, face/bar evidence may
    # assist top detection as long as the elbows still flexed
    # meaningfully.
    face_assisted_top_max_angle_deg: float = 120.0

    # MediaPipe Pose has no chin landmark. We use the midpoint of the
    # mouth landmarks as a conservative face reference. Negative means
    # the mouth is above the wrist midpoint. A tiny positive tolerance
    # absorbs normal landmark jitter around bar height.
    face_to_wrist_top_tolerance: float = 0.01

    # Face/bar evidence is accepted only after the shoulders have risen
    # a meaningful fraction of their bottom-to-wrist vertical distance.
    # This prevents a noisy face landmark from declaring TOP too early.
    face_assisted_top_min_body_rise_ratio: float = 0.35

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

    hand_labels_are_mirrored: bool = True  # MediaPipe labels assume selfie view
    min_handedness_confidence: float = 0.6
    max_wrist_association_distance: float = 0.35
    hand_crop_forward_offset_ratio: float = 0.12

    # ---------------------------------------------------------
    # HANG CONFIRMATION
    # ---------------------------------------------------------

    # Roughly equivalent to the original 15-frame window at
    # ~30 analyzed frames per second.
    hang_confirmation_seconds: float = 0.35

    # During initial hang confirmation we do NOT require the wrists
    # to stay at the same raw screen x/y coordinates. Camera shake
    # moves the whole image, so absolute wrist position is not a
    # reliable anchor cue.
    #
    # evidence.py applies this threshold to the change in LEFT↔RIGHT
    # wrist span instead. Global camera translation moves both wrists
    # together but preserves their distance.
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
    # GRIP / MOVEMENT CLASSIFICATION
    # ---------------------------------------------------------

    # Hand Landmarker is heavier than Pose Landmarker, so we sample
    # the hands less frequently while the athlete is on the bar.
    target_hand_analysis_fps: float = 8.0

    # Ignore weak palm-plane orientation. Values near zero usually
    # mean the hand is edge-on, occluded, or otherwise ambiguous.
    palm_facing_threshold: float = 0.20

    # Empirical sign calibration inherited from the successful
    # front-facing pull-up/chin-up prototype.
    palm_score_direction: float = -1.0

    # MVP grip classification currently assumes the athlete faces
    # the camera. Rear-facing footage should be treated separately
    # rather than silently flipping pull-up/chin-up labels.
    athlete_faces_camera: bool = True

    # Require several usable hand observations inside a rep before
    # assigning pull-up vs chin-up.
    min_rep_grip_samples: int = 3
    rep_grip_majority_ratio: float = 0.70
    # When ordinary frame votes are too sparse, two temporally distinct
    # single-hand observations may still resolve orientation if both have
    # twice the minimum palm-plane margin and agree unanimously. This keeps
    # near-threshold hand extrapolations from deciding the movement.
    min_strong_rep_grip_samples: int = 2
    strong_rep_grip_score_multiplier: float = 2.0
    strong_rep_grip_majority_ratio: float = 1.0

    # Classification only; these never alter the rep phase tracker.
    min_rep_width_samples: int = 3
    width_majority_ratio: float = 0.70
    # A winning width must also be supported by a clear majority of every
    # frame in the rep, including frames that fell in a threshold gap.
    width_min_total_support_ratio: float = 0.60
    close_wrist_shoulder_ratio: float = 0.85
    wide_wrist_shoulder_ratio: float = 1.65
    min_rep_height_samples: int = 3
    height_peak_window_ms: int = 250
    height_peak_window_preferred_samples: int = 5
    # Upper-chest proxy = shoulder line + 1/4 projected torso length.
    # The score is (upper chest - wrist/bar line) / projected torso length.
    # A high pull requires the upper chest to come within 1/10 projected torso
    # length of the inferred bar line. Ordinary clearance remains at least
    # 1/4 torso below it, leaving a deliberately broad uncertainty band.
    height_upper_chest_fraction: float = 0.25
    high_chest_bar_ratio_max: float = 0.10
    standard_chest_bar_ratio_min: float = 0.25
    # Camera-invariant stability check over a candidate peak window. The
    # normalized score already subtracts the inferred wrist/bar line from the
    # chest proxy, so its MAD rejects incoherent evidence without treating
    # global camera translation as wrist drift.
    height_max_chest_score_mad: float = 0.15
    height_max_torso_span_spread_ratio: float = 0.25

    # Crop the original-resolution frame around each pose wrist so
    # Hand Landmarker receives enough hand detail.
    min_hand_crop_size_px: int = 180
    max_hand_crop_size_px: int = 520
    hand_crop_shoulder_multiplier: float = 1.55

    min_hand_detection_confidence: float = 0.45
    min_hand_presence_confidence: float = 0.45

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
