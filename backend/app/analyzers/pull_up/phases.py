from __future__ import annotations

from dataclasses import dataclass, field

from app.analyzers.common.types import (
    PhaseEvent,
    RepAnalysis,
    RepOutcome,
    RepPhase,
)
from app.analyzers.pull_up.config import PullUpAnalyzerConfig


@dataclass
class PullUpPhaseTracker:
    config: PullUpAnalyzerConfig

    phase: RepPhase = RepPhase.UNKNOWN

    rep_index: int = 0

    rep_start_ms: int | None = None
    top_ms: int | None = None

    minimum_angle_deg: float | None = None
    top_entry_angle_deg: float | None = None

    # Shoulder Y relative to the wrists at the bottom of the current
    # candidate rep. In normalized image coordinates, a smaller value
    # means the shoulders moved upward toward the hands.
    bottom_body_relative_y: float | None = None

    phase_events: list[PhaseEvent] = field(
        default_factory=list,
    )

    def update(
        self,
        *,
        timestamp_ms: int,
        angle_deg: float,
        body_relative_y: float | None = None,
        face_to_wrist_y: float | None = None,
    ) -> RepAnalysis | None:
        if self.phase == RepPhase.UNKNOWN:
            if angle_deg >= self.config.bottom_angle_deg:
                self._start_candidate(
                    timestamp_ms,
                    body_relative_y=body_relative_y,
                )

            return None

        if self.phase == RepPhase.BOTTOM:
            if angle_deg >= self.config.bottom_angle_deg:
                self._refresh_bottom_reference(
                    timestamp_ms=timestamp_ms,
                    body_relative_y=body_relative_y,
                )

                return None

            elbow_left_bottom = (
                angle_deg
                <= self.config.bottom_angle_deg
                - self.config.motion_angle_delta_deg
            )

            if (
                elbow_left_bottom
                and self._body_rise_is_confirmed(body_relative_y)
            ):
                self._set_phase(
                    RepPhase.RISING,
                    timestamp_ms,
                )

                self.minimum_angle_deg = angle_deg

            return None

        if self.phase == RepPhase.RISING:
            self._update_minimum_angle(angle_deg)

            if self._top_is_confirmed(
                angle_deg=angle_deg,
                body_relative_y=body_relative_y,
                face_to_wrist_y=face_to_wrist_y,
            ):
                self._set_phase(
                    RepPhase.TOP,
                    timestamp_ms,
                )

                self.top_ms = timestamp_ms
                self.top_entry_angle_deg = angle_deg

                return None

            if angle_deg >= self.config.bottom_angle_deg:
                minimum_angle = self.minimum_angle_deg

                if (
                    minimum_angle is not None
                    and minimum_angle
                    <= self.config.partial_top_angle_deg
                ):
                    self._set_phase(
                        RepPhase.BOTTOM,
                        timestamp_ms,
                    )

                    return self._finish_rep(
                        outcome=RepOutcome.PARTIAL,
                        end_ms=timestamp_ms,
                        reason_codes=["did_not_reach_top"],
                        continue_from_bottom=True,
                        bottom_body_relative_y=body_relative_y,
                    )

                # The athlete barely moved away from the bottom.
                # Do not count that as a rep.
                self._start_candidate(
                    timestamp_ms,
                    body_relative_y=body_relative_y,
                )

            return None

        if self.phase == RepPhase.TOP:
            # Handle a large frame-to-frame jump directly back
            # to the bottom.
            if angle_deg >= self.config.bottom_angle_deg:
                self._set_phase(
                    RepPhase.LOWERING,
                    timestamp_ms,
                )

                self._set_phase(
                    RepPhase.BOTTOM,
                    timestamp_ms,
                )

                return self._finish_rep(
                    outcome=RepOutcome.VALID,
                    end_ms=timestamp_ms,
                    continue_from_bottom=True,
                    bottom_body_relative_y=body_relative_y,
                )

            if self._lowering_has_started(angle_deg):
                self._set_phase(
                    RepPhase.LOWERING,
                    timestamp_ms,
                )

            return None

        if (
            self.phase == RepPhase.LOWERING
            and angle_deg >= self.config.bottom_angle_deg
        ):
            self._set_phase(
                RepPhase.BOTTOM,
                timestamp_ms,
            )

            return self._finish_rep(
                outcome=RepOutcome.VALID,
                end_ms=timestamp_ms,
                continue_from_bottom=True,
                bottom_body_relative_y=body_relative_y,
            )

        return None

    def interrupt(
        self,
        *,
        timestamp_ms: int,
        reason_code: str,
    ) -> RepAnalysis | None:
        """
        Stop the current candidate because the analyzer no longer
        has enough trustworthy evidence.

        A meaningful rep already in motion becomes uncertain.
        Simply hanging at the bottom does not create a rep.
        """

        if self.phase not in {
            RepPhase.RISING,
            RepPhase.TOP,
            RepPhase.LOWERING,
        }:
            self._reset()
            return None

        return self._finish_rep(
            outcome=RepOutcome.UNCERTAIN,
            end_ms=timestamp_ms,
            reason_codes=[reason_code],
            continue_from_bottom=False,
        )

    def _top_is_confirmed(
        self,
        *,
        angle_deg: float,
        body_relative_y: float | None,
        face_to_wrist_y: float | None,
    ) -> bool:
        # Strong elbow flexion remains sufficient on its own.
        if angle_deg <= self.config.top_angle_deg:
            return True

        # For a wide pull-up the elbows may remain relatively open.
        # In that case we require several independent cues together:
        #   1. face reference reaches wrist/bar level,
        #   2. elbows still flexed meaningfully,
        #   3. shoulders rose substantially from the bottom baseline.
        if face_to_wrist_y is None:
            return False

        if (
            face_to_wrist_y
            > self.config.face_to_wrist_top_tolerance
        ):
            return False

        if (
            angle_deg
            > self.config.face_assisted_top_max_angle_deg
        ):
            return False

        body_rise_ratio = self._body_rise_ratio(
            body_relative_y
        )

        if body_rise_ratio is None:
            return False

        return (
            body_rise_ratio
            >= self.config.face_assisted_top_min_body_rise_ratio
        )

    def _body_rise_is_confirmed(
        self,
        body_relative_y: float | None,
    ) -> bool:
        # Keep the tracker independently usable in tests or callers
        # that do not provide body motion. Production pull-up analysis
        # does provide this value.
        if (
            body_relative_y is None
            or self.bottom_body_relative_y is None
        ):
            return True

        body_rise = (
            self.bottom_body_relative_y - body_relative_y
        )

        return (
            body_rise
            >= self.config.rep_start_body_rise_threshold
        )

    def _body_rise_ratio(
        self,
        body_relative_y: float | None,
    ) -> float | None:
        if (
            body_relative_y is None
            or self.bottom_body_relative_y is None
        ):
            return None

        bottom_distance = abs(self.bottom_body_relative_y)

        if bottom_distance <= 1e-6:
            return None

        body_rise = (
            self.bottom_body_relative_y - body_relative_y
        )

        return body_rise / bottom_distance

    def _lowering_has_started(
        self,
        angle_deg: float,
    ) -> bool:
        if self.top_entry_angle_deg is None:
            return False

        return (
            angle_deg
            >= self.top_entry_angle_deg
            + self.config.motion_angle_delta_deg
        )

    def _refresh_bottom_reference(
        self,
        *,
        timestamp_ms: int,
        body_relative_y: float | None,
    ) -> None:
        # While the athlete remains at the bottom, keep the baseline
        # close to the actual start of the next attempt instead of an
        # arbitrarily old dead-hang frame.
        self.rep_start_ms = timestamp_ms

        if body_relative_y is not None:
            self.bottom_body_relative_y = body_relative_y

        self.top_ms = None
        self.minimum_angle_deg = None
        self.top_entry_angle_deg = None

        self.phase_events = [
            PhaseEvent(
                phase=RepPhase.BOTTOM,
                timestamp_ms=timestamp_ms,
            )
        ]

    def _start_candidate(
        self,
        timestamp_ms: int,
        *,
        body_relative_y: float | None,
    ) -> None:
        self.phase = RepPhase.BOTTOM
        self.rep_start_ms = timestamp_ms
        self.top_ms = None
        self.minimum_angle_deg = None
        self.top_entry_angle_deg = None
        self.bottom_body_relative_y = body_relative_y

        self.phase_events = [
            PhaseEvent(
                phase=RepPhase.BOTTOM,
                timestamp_ms=timestamp_ms,
            )
        ]

    def _set_phase(
        self,
        phase: RepPhase,
        timestamp_ms: int,
    ) -> None:
        if phase == self.phase:
            return

        self.phase = phase

        self.phase_events.append(
            PhaseEvent(
                phase=phase,
                timestamp_ms=timestamp_ms,
            )
        )

    def _update_minimum_angle(
        self,
        angle_deg: float,
    ) -> None:
        if self.minimum_angle_deg is None:
            self.minimum_angle_deg = angle_deg
            return

        self.minimum_angle_deg = min(
            self.minimum_angle_deg,
            angle_deg,
        )

    def _finish_rep(
        self,
        *,
        outcome: RepOutcome,
        end_ms: int,
        reason_codes: list[str] | None = None,
        continue_from_bottom: bool,
        bottom_body_relative_y: float | None = None,
    ) -> RepAnalysis:
        if self.rep_start_ms is None:
            raise RuntimeError(
                "Cannot finish a rep without a start timestamp."
            )

        self.rep_index += 1

        result = RepAnalysis(
            rep_index=self.rep_index,
            outcome=outcome,
            start_ms=self.rep_start_ms,
            top_ms=self.top_ms,
            end_ms=end_ms,
            phase_events=list(self.phase_events),
            reason_codes=reason_codes or [],
        )

        if continue_from_bottom:
            self._start_candidate(
                end_ms,
                body_relative_y=bottom_body_relative_y,
            )
        else:
            self._reset()

        return result

    def _reset(self) -> None:
        self.phase = RepPhase.UNKNOWN
        self.rep_start_ms = None
        self.top_ms = None
        self.minimum_angle_deg = None
        self.top_entry_angle_deg = None
        self.bottom_body_relative_y = None
        self.phase_events.clear()
