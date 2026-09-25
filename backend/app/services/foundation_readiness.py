"""Narrow policy for which published performance rules may use self-report."""

from __future__ import annotations

from app.models.movement import Movement
from app.schemas.movement_safety import MovementPerformanceRule, MovementSafetyContent

FOUNDATION_RULES = {
    "pull-up": ("recent_logged_pull_up", 1),
    "push-up": ("recent_logged_push_up", 5),
    "dips": ("recent_logged_dips", 1),
}


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
