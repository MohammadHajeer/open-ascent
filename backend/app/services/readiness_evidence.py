"""Build movement readiness evidence from owner-scoped, provenance-labelled facts."""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from decimal import Decimal

from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.analysis import Analysis
from app.models.enums import MovementPrescriptionType
from app.models.movement import Movement
from app.models.profile import Profile
from app.models.readiness_self_report import ReadinessSelfReport
from app.models.training import WorkoutSession, WorkoutSet
from app.schemas.movement_safety import MovementPerformanceRule, MovementSafetyContent
from app.schemas.readiness import ReadinessEvidence
from app.services.foundation_readiness import permits_structured_self_report
from app.services.movement_documentation import MovementDocumentationService

ASSESSMENT_REP_KEYS = {
    "pull-up": "pull_up",
    "push-up": "push_up",
    "dips": "dips",
}


@dataclass(frozen=True)
class _Observation:
    value: Decimal
    source: str
    observed_at: datetime
    reference_id: uuid.UUID
    is_max_test: bool


def _utc(value: datetime) -> datetime:
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)


def _target_matched_rep_count(analysis: Analysis) -> int | None:
    """Count only analyzer-valid reps positively matched to the canonical target."""
    result = analysis.result
    if not isinstance(result, dict) or not isinstance(result.get("reps"), list):
        return None
    reps = result["reps"]
    if not reps or any(not isinstance(rep, dict) for rep in reps):
        return None
    if (
        type(result.get("valid_rep_count")) is not int
        or result["valid_rep_count"] != analysis.valid_rep_count
        or result.get("outcome") != analysis.terminal_outcome
        or analysis.terminal_outcome not in {"completed", "zero_valid_reps"}
        or sum(rep.get("outcome") == "valid" for rep in reps)
        != analysis.valid_rep_count
    ):
        return None
    matched = sum(
        rep.get("outcome") == "valid" and rep.get("target_match") is True
        for rep in reps
    )
    if matched and analysis.terminal_outcome == "completed":
        return matched
    # An explicit maximum attempt with a positively recognized target can
    # disprove the threshold. Unknown target classification cannot.
    if (
        analysis.execution_intent == "max_test"
        and analysis.terminal_outcome == "zero_valid_reps"
        and any(rep.get("target_match") is True for rep in reps)
        and all(type(rep.get("target_match")) is bool for rep in reps)
    ):
        return 0
    return None


class ReadinessEvidenceBuilder:
    @staticmethod
    def build(
        db: Session,
        *,
        user_id: uuid.UUID,
        movement_id: uuid.UUID,
        now: datetime | None = None,
    ) -> list[ReadinessEvidence]:
        profile = db.scalar(
            select(Profile).where(Profile.id == user_id, Profile.app_role == "athlete")
        )
        movement = db.get(Movement, movement_id)
        if profile is None or movement is None:
            return []

        documentation = MovementDocumentationService.get_published(db, movement_id)
        if documentation is None:
            return []
        try:
            safety = MovementSafetyContent.model_validate(documentation.content)
        except ValidationError:
            return []

        evidence: list[ReadinessEvidence] = []
        avoided = {
            str(item) for item in (profile.coaching_context or {}).get("avoid_movement_ids", [])
        }
        if str(movement_id) in avoided:
            evidence.append(
                ReadinessEvidence(
                    requirement="Athlete has chosen to avoid this movement.",
                    satisfied=False,
                    source="coaching_context",
                )
            )

        evaluated_at = _utc(now or datetime.now(UTC))
        # Published prose remains athlete-facing guidance. Only explicit,
        # machine-readable rules create readiness gates.
        for rule in sorted(
            safety.readiness_rules or [], key=lambda item: item.prerequisite_index
        ):
            requirement = safety.prerequisites[rule.prerequisite_index]
            evidence.append(
                ReadinessEvidenceBuilder._evaluate_rule(
                    db, profile, movement, documentation.id, safety, rule, requirement, evaluated_at
                )
            )
        return evidence

    @staticmethod
    def _evaluate_rule(
        db: Session,
        profile: Profile,
        target_movement: Movement,
        documentation_id: uuid.UUID,
        safety: MovementSafetyContent,
        rule: MovementPerformanceRule,
        requirement: str,
        now: datetime,
    ) -> ReadinessEvidence:
        cutoff = now - timedelta(days=rule.max_age_days)
        observations: list[_Observation] = []
        accepted = set(rule.accepted_sources)
        source_movement = db.get(Movement, rule.movement_id)
        expected_type = (
            MovementPrescriptionType.REPETITIONS
            if rule.metric == "reps"
            else MovementPrescriptionType.DURATION
        )
        if source_movement is None or source_movement.prescription_type != expected_type:
            return ReadinessEvidence(requirement=requirement)

        report = None
        if "structured_self_report" in accepted and permits_structured_self_report(target_movement, safety, rule):
            report = db.scalar(
                select(ReadinessSelfReport)
                .where(
                    ReadinessSelfReport.user_id == profile.id,
                    ReadinessSelfReport.movement_id == target_movement.id,
                    ReadinessSelfReport.documentation_id == documentation_id,
                    ReadinessSelfReport.rule_code == rule.code,
                    ReadinessSelfReport.reported_at >= cutoff,
                    ReadinessSelfReport.reported_at <= now,
                )
                .order_by(ReadinessSelfReport.reported_at.desc(), ReadinessSelfReport.id.desc())
                .limit(1)
            )

        if "initial_assessment" in accepted and rule.metric == "reps":
            assessment = profile.initial_assessment or {}
            key = ASSESSMENT_REP_KEYS.get(source_movement.slug)
            reported = (assessment.get("answers") or {}).get("max_clean_reps") or {}
            timestamp = assessment.get("submitted_at")
            if key and isinstance(reported.get(key), int) and not isinstance(reported[key], bool):
                try:
                    observed_at = _utc(datetime.fromisoformat(timestamp))
                except (TypeError, ValueError):
                    observed_at = None
                if observed_at is not None and cutoff <= observed_at <= now:
                    observations.append(
                        _Observation(
                            value=Decimal(reported[key]),
                            source="initial_assessment",
                            observed_at=observed_at,
                            reference_id=profile.id,
                            is_max_test=True,
                        )
                    )

        logged_sources = accepted & {"manual", "self_reported"}
        if logged_sources:
            rows = db.execute(
                select(WorkoutSet, WorkoutSession.started_at)
                .join(WorkoutSession, WorkoutSession.id == WorkoutSet.session_id)
                .where(
                    WorkoutSession.user_id == profile.id,
                    WorkoutSet.performer == "self",
                    WorkoutSet.movement_id == rule.movement_id,
                    WorkoutSet.source.in_(logged_sources),
                    WorkoutSession.started_at >= cutoff,
                    WorkoutSession.started_at <= now,
                )
            )
            for workout_set, started_at in rows:
                value = (
                    workout_set.reps
                    if rule.metric == "reps"
                    else workout_set.hold_seconds
                )
                if value is not None:
                    observations.append(
                        _Observation(
                            value=Decimal(value),
                            source=workout_set.source,
                            observed_at=_utc(started_at),
                            reference_id=workout_set.id,
                            is_max_test=workout_set.intent == "max_test",
                        )
                    )

        if "uploaded_analysis" in accepted and rule.metric == "reps":
            # WorkoutSet values are editable. The aggregate valid_rep_count
            # also includes reps that may not match the requested variation.
            rows = db.execute(
                select(Analysis)
                .join(WorkoutSet, WorkoutSet.analysis_id == Analysis.id)
                .join(WorkoutSession, WorkoutSession.id == WorkoutSet.session_id)
                .where(
                    WorkoutSession.user_id == profile.id,
                    WorkoutSet.performer == "self",
                    WorkoutSet.source == "uploaded_analysis",
                    WorkoutSet.movement_id == rule.movement_id,
                    Analysis.user_id == profile.id,
                    Analysis.owner_kind == "authenticated",
                    Analysis.movement_id == rule.movement_id,
                    Analysis.status == "completed",
                    Analysis.valid_rep_count.is_not(None),
                    Analysis.completed_at >= cutoff,
                    Analysis.completed_at <= now,
                )
            )
            for analysis in rows.scalars():
                matched_count = _target_matched_rep_count(analysis)
                if matched_count is None:
                    continue
                observations.append(
                    _Observation(
                        value=Decimal(matched_count),
                        source="uploaded_analysis",
                        observed_at=_utc(analysis.completed_at),
                        reference_id=analysis.id,
                        is_max_test=analysis.execution_intent == "max_test",
                    )
                )

        # A current explicit avoidance always blocks the movement. A newer
        # negative ability answer blocks older training, while later directly
        # comparable training may supersede it. A positive answer is used only
        # when no accepted stronger observations exist.
        if report is not None:
            latest_stronger = max((item.observed_at for item in observations), default=None)
            reported_at = _utc(report.reported_at)
            if report.response == "avoid" or (
                report.response == "not_yet"
                and (latest_stronger is None or latest_stronger <= reported_at)
            ):
                return ReadinessEvidence(
                    requirement=requirement, satisfied=False,
                    source="structured_self_report", observed_at=reported_at,
                    reference_id=report.id, observed_value=Decimal(0),
                )
            if report.response == "able" and not observations:
                return ReadinessEvidence(
                    requirement=requirement, satisfied=True,
                    source="structured_self_report", observed_at=reported_at,
                    reference_id=report.id, observed_value=rule.value,
                )

        # The live_coach workout source is currently user-writable and has no
        # verified session measurement relation. It cannot prove readiness.
        max_tests = sorted(
            (item for item in observations if item.is_max_test),
            key=lambda item: item.observed_at,
            reverse=True,
        )
        qualifying = sorted(
            (item for item in observations if item.value >= rule.value),
            key=lambda item: item.observed_at,
            reverse=True,
        )
        latest_max = max_tests[0] if max_tests else None
        latest_qualifying = qualifying[0] if qualifying else None
        chosen = (
            latest_max
            if latest_max is not None
            and (
                latest_qualifying is None
                or latest_max.observed_at >= latest_qualifying.observed_at
            )
            else latest_qualifying
        )
        if chosen is None:
            return ReadinessEvidence(requirement=requirement)
        return ReadinessEvidence(
            requirement=requirement,
            satisfied=chosen.value >= rule.value,
            source=chosen.source,
            observed_at=chosen.observed_at,
            reference_id=chosen.reference_id,
            observed_value=chosen.value,
        )
