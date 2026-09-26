"""Narrow policy for which published performance rules may use self-report."""

from __future__ import annotations

from app.models.movement import Movement
from app.schemas.movement_safety import MovementPerformanceRule, MovementSafetyContent
from app.schemas.readiness import ReadinessEvidence

FOUNDATION_RULES = {
    "pull-up": ("recent_logged_pull_up", 1),
    "push-up": ("recent_logged_push_up", 5),
    "dips": ("recent_logged_dips", 1),
}
# Onboarding answers to the structured "max clean reps" question. They are the
# weakest provisional source: any Quick readiness answer, logged set, or
# measurement for the same rule supersedes them.
ONBOARDING_SELF_REPORT = "onboarding_self_report"
PROVISIONAL_SOURCES = frozenset(
    {"structured_self_report", ONBOARDING_SELF_REPORT, "initial_assessment"}
)
# Provisional-only starter plans stay within these limits (SAF-04 policy).
PROVISIONAL_MAX_SETS = 3
PROVISIONAL_MAX_TRAINING_DAYS = 3


def is_provisional_pass(item: ReadinessEvidence) -> bool:
    return item.source in PROVISIONAL_SOURCES and item.satisfied is True


def permits_structured_self_report(
    target: Movement, safety: MovementSafetyContent, rule: MovementPerformanceRule
) -> bool:
    expected = FOUNDATION_RULES.get(target.slug)
    return bool(
        expected
        and rule.code == expected[0]
        and rule.value == expected[1]
        and rule.movement_id == target.id
        and rule.metric == "reps"
        and rule.max_age_days <= 90
        and "structured_self_report" in rule.accepted_sources
        and rule.prerequisite_index < len(safety.prerequisites)
    )
