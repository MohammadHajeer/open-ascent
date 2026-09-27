"""Small, explicit goal training paths.

A path names the canonical movements and supporting exercises that are
relevant to a destination, with the role each plays. It never grants
readiness: every entry still passes SAF-04 or supporting-exercise
applicability before it can enter the allowed exercise pool.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Literal

Role = Literal["foundation", "goal_specific", "balance"]


@dataclass(frozen=True)
class GoalPath:
    key: str
    name: str
    emphasis: str
    goal_slugs: frozenset[str]
    canonical: tuple[tuple[str, Role], ...]
    supporting: tuple[tuple[str, Role], ...]


PATHS: dict[str, GoalPath] = {
    path.key: path
    for path in (
        GoalPath(
            key="general", name="General strength",
            emphasis="Balanced foundation pulling, pushing, and body-line work.",
            goal_slugs=frozenset(),
            canonical=(("pull-up", "foundation"), ("push-up", "foundation"), ("dips", "foundation")),
            supporting=(
                ("negative-pull-up", "foundation"), ("scapular-pull-up", "foundation"),
                ("australian-row", "foundation"), ("incline-push-up", "foundation"),
                ("dip-support-hold", "foundation"), ("hollow-body-hold", "foundation"),
            ),
        ),
        GoalPath(
            key="pull-up", name="Stronger pulling",
            emphasis="Vertical pulling strength first, with horizontal pulling and scapular control in support.",
            goal_slugs=frozenset({
                "pull-up", "chin-up", "close-grip-pull-up", "wide-grip-pull-up", "high-pull-up",
            }),
            canonical=(
                ("pull-up", "foundation"), ("chin-up", "goal_specific"),
                ("close-grip-pull-up", "goal_specific"), ("wide-grip-pull-up", "goal_specific"),
                ("high-pull-up", "goal_specific"), ("push-up", "balance"), ("dips", "balance"),
            ),
            supporting=(
                ("negative-pull-up", "foundation"), ("scapular-pull-up", "foundation"),
                ("australian-row", "foundation"), ("hollow-body-hold", "foundation"),
            ),
        ),
        GoalPath(
            key="front-lever", name="Front Lever",
            emphasis="Vertical pulling strength, scapular control, horizontal pulling, and straight-arm lever progressions.",
            goal_slugs=frozenset({"front-lever", "inverted-deadlift"}),
            canonical=(
                ("pull-up", "foundation"), ("front-lever", "goal_specific"),
                ("inverted-deadlift", "goal_specific"), ("push-up", "balance"), ("dips", "balance"),
            ),
            supporting=(
                ("scapular-pull-up", "foundation"), ("negative-pull-up", "foundation"),
                ("australian-row", "foundation"), ("hollow-body-hold", "foundation"),
                ("tuck-front-lever-hold", "goal_specific"), ("ice-cream-maker", "goal_specific"),
            ),
        ),
        GoalPath(
            key="back-lever", name="Back Lever",
            emphasis="Pulling and support strength with gradual shoulder-extension and straight-arm progressions.",
            goal_slugs=frozenset({"back-lever"}),
            canonical=(
                ("pull-up", "foundation"), ("dips", "foundation"),
                ("back-lever", "goal_specific"), ("push-up", "balance"),
            ),
            supporting=(
                ("scapular-pull-up", "foundation"), ("negative-pull-up", "foundation"),
                ("dip-support-hold", "foundation"), ("hollow-body-hold", "foundation"),
                ("german-hang", "goal_specific"), ("tuck-back-lever-hold", "goal_specific"),
            ),
        ),
        GoalPath(
            key="muscle-up", name="Muscle-Up",
            emphasis="Strong pulling, explosive high pulls, and straight-bar support, trained separately before the full skill.",
            goal_slugs=frozenset({"muscle-up"}),
            canonical=(
                ("pull-up", "foundation"), ("dips", "foundation"),
                ("high-pull-up", "goal_specific"), ("muscle-up", "goal_specific"),
                ("push-up", "balance"),
            ),
            supporting=(
                ("scapular-pull-up", "foundation"), ("negative-pull-up", "foundation"),
                ("dip-support-hold", "foundation"), ("straight-bar-dip", "goal_specific"),
            ),
        ),
        GoalPath(
            key="pushing", name="Stronger pushing",
            emphasis="Pressing strength and support stability, balanced with pulling.",
            goal_slugs=frozenset({"push-up", "dips"}),
            canonical=(("push-up", "foundation"), ("dips", "foundation"), ("pull-up", "balance")),
            supporting=(
                ("incline-push-up", "foundation"), ("dip-support-hold", "foundation"),
                ("hollow-body-hold", "foundation"),
            ),
        ),
    )
}

# Informal names a Coach plan request may use for a goal movement.
_ALIASES = {
    "front lever": "front-lever", "frontlever": "front-lever",
    "back lever": "back-lever", "backlever": "back-lever",
    "muscle up": "muscle-up", "muscleup": "muscle-up",
    "inverted deadlift": "inverted-deadlift", "high pull up": "high-pull-up",
    "pull up": "pull-up", "pullup": "pull-up", "chin up": "chin-up",
    "dips": "dips", "dip": "dips", "push up": "push-up", "pushup": "push-up",
}


def path_for_goal(slug: str | None) -> GoalPath:
    if slug:
        for path in PATHS.values():
            if slug in path.goal_slugs:
                return path
    return PATHS["general"]


_SKILLS = frozenset({"front-lever", "back-lever", "muscle-up", "inverted-deadlift"})


def goal_slug_from_text(text: str) -> str | None:
    """Deterministic goal recognition for Coach plan requests.

    One named skill wins over foundation movements mentioned beside it; several
    unrelated movements mean a general plan.
    """
    normalized = " " + " ".join(re.sub(r"[^a-z0-9]+", " ", text.lower()).split()) + " "
    normalized = normalized.replace(" ups ", " up ").replace(" levers ", " lever ")
    found = {slug for alias, slug in _ALIASES.items() if f" {alias} " in normalized}
    if "high-pull-up" in found:
        found.discard("pull-up")
    skills = found & _SKILLS
    if len(skills) == 1:
        return next(iter(skills))
    return next(iter(found)) if len(found) == 1 else None
