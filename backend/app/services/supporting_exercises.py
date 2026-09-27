"""Curated, versioned supporting exercises that plans may prescribe.

A supporting exercise is a curated regression, progression, or accessory;
where possible it is an easier option or prerequisite named in a published
Open Ascent guide. It is not a canonical
movement: it has no uploaded analysis, Live Coach support, readiness testing,
or capability tracking. Its applicability is gated on SAF-04 decisions and
capability for the canonical movement it builds on, never on a model judgment.

Keys are stable identifiers stored in saved plans. Never rename or delete an
entry; set ``retired=True`` so historical plans stay readable. An entry must
never be an ungated alias of a gated canonical movement.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Literal

CATALOG_VERSION = 1

Target = Literal["reps", "hold_seconds"]
Pattern = Literal["vertical_pull", "horizontal_pull", "straight_arm_pull", "push", "core"]
Gate = Literal["known", "pass"]


@dataclass(frozen=True)
class SupportingExercise:
    key: str
    name: str
    target: Target
    pattern: Pattern
    # Any one listed item satisfies the requirement; empty means none needed.
    equipment: tuple[str, ...]
    purpose: str
    setup: tuple[str, ...]
    execution: tuple[str, ...]
    common_mistakes: tuple[str, ...]
    sets: tuple[int, int]
    amount: tuple[int, int]
    rest_seconds: tuple[int, int]
    # The canonical movement this exercise builds on. "known" needs recorded
    # readiness evidence (PASS, or a not-yet answer) without avoidance;
    # "pass" needs SAF-04 PASS.
    gate_movement: str | None = None
    gate: Gate = "known"
    min_reps: int | None = None
    # Relevance ceiling for regressions; a strong athlete does not need them.
    max_reps: int | None = None
    # Avoiding any of these canonical movements makes this exercise unavailable.
    avoid_blocks: tuple[str, ...] = ()
    # A structured onboarding dimension that must have been answered.
    needs_dimension: str | None = None
    # Demanding work that must not be scheduled on consecutive days.
    intense: bool = False
    retired: bool = False


CATALOG: tuple[SupportingExercise, ...] = (
    SupportingExercise(
        key="scapular-pull-up", name="Scapular Pull-Up", target="reps",
        pattern="vertical_pull", equipment=("pull_up_bar", "rings"),
        purpose="Trains the shoulder-blade control that Pull-Ups and lever work depend on.",
        setup=("Hang from the bar with straight arms and a secure grip.",),
        execution=(
            "Pull the shoulder blades down and back without bending the elbows.",
            "Pause briefly, then lower back to a controlled hang.",
        ),
        common_mistakes=("Bending the elbows to turn it into a partial pull-up.", "Dropping quickly into the hang."),
        sets=(2, 4), amount=(5, 12), rest_seconds=(45, 120),
        gate_movement="pull-up", gate="known",
    ),
    SupportingExercise(
        key="negative-pull-up", name="Eccentric Pull-Up", target="reps",
        pattern="vertical_pull", equipment=("pull_up_bar", "rings"),
        purpose="Builds pulling strength through slow lowering while full Pull-Ups are still limited.",
        setup=("Start at the top position with the chin over the bar, stepping up from a stable support.",),
        execution=("Lower under control for about three to five seconds to a full hang.", "Step back up; do not jump into the top position."),
        common_mistakes=("Dropping through the bottom half.", "Jumping up with momentum."),
        sets=(2, 4), amount=(2, 5), rest_seconds=(90, 180),
        gate_movement="pull-up", gate="known", max_reps=5,
    ),
    SupportingExercise(
        key="australian-row", name="Ring Row", target="reps",
        pattern="horizontal_pull", equipment=("rings",),
        purpose="Horizontal pulling with an adjustable body angle; balances vertical pulling and supports lever preparation.",
        setup=("Set the rings around waist height and lean back with a straight body.",),
        execution=("Pull the chest toward the rings while keeping the body line.", "Lower until the arms are straight."),
        common_mistakes=("Letting the hips sag.", "Shrugging the shoulders toward the ears."),
        sets=(2, 4), amount=(6, 15), rest_seconds=(60, 150),
        gate_movement="pull-up", gate="known",
    ),
    SupportingExercise(
        key="tuck-front-lever-hold", name="Tuck Front Lever Hold", target="hold_seconds",
        pattern="straight_arm_pull", equipment=("pull_up_bar", "rings"),
        purpose="The easier Front Lever progression named in the Front Lever guide; trains straight-arm pulling with a short lever.",
        setup=("Hang from the bar and pull the knees tightly toward the chest.",),
        execution=(
            "With straight arms, press the bar down to lift the hips until the back is roughly level.",
            "Hold the position with the shoulder blades depressed, then lower under control.",
        ),
        common_mistakes=("Bending the elbows to reach the position.", "Letting the hips drop below the shoulders."),
        sets=(3, 5), amount=(5, 12), rest_seconds=(90, 180),
        gate_movement="pull-up", gate="pass", min_reps=8,
        avoid_blocks=("front-lever",), intense=True,
    ),
    SupportingExercise(
        key="ice-cream-maker", name="Ice-Cream Maker", target="reps",
        pattern="straight_arm_pull", equipment=("pull_up_bar", "rings"),
        purpose="Moves from the top of a pull-up toward a tucked lever position to build Front Lever transition strength.",
        setup=("Start at the top of a controlled pull-up.",),
        execution=(
            "Lean back while extending the arms and lifting the hips toward a tucked lever position.",
            "Reverse the path to return to the top position under control.",
        ),
        common_mistakes=("Swinging to create momentum.", "Losing a tight tuck at the lever position."),
        sets=(2, 4), amount=(3, 6), rest_seconds=(120, 210),
        gate_movement="pull-up", gate="pass", min_reps=12,
        avoid_blocks=("front-lever",), intense=True,
    ),
    SupportingExercise(
        key="german-hang", name="German Hang", target="hold_seconds",
        pattern="straight_arm_pull", equipment=("rings", "pull_up_bar"),
        purpose="Gradually builds the shoulder-extension tolerance used in Back Lever training.",
        setup=("From a hang, tuck and rotate backward through the arms until the feet point toward the floor.",),
        execution=("Hold only a comfortable depth of stretch.", "Return the same way under control."),
        common_mistakes=("Dropping into the bottom position.", "Forcing depth that feels painful."),
        sets=(2, 4), amount=(5, 20), rest_seconds=(60, 120),
        gate_movement="pull-up", gate="pass",
        avoid_blocks=("back-lever",), intense=True,
    ),
    SupportingExercise(
        key="tuck-back-lever-hold", name="Tuck Back Lever Hold", target="hold_seconds",
        pattern="straight_arm_pull", equipment=("rings", "pull_up_bar"),
        purpose="The easier Back Lever progression named in the Back Lever guide.",
        setup=("From an inverted tuck, lower backward until the back is roughly level.",),
        execution=("Keep the arms straight and the knees tucked.", "Hold briefly, then return to the inverted tuck."),
        common_mistakes=("Bending the elbows.", "Arching the lower back to reach level."),
        sets=(3, 5), amount=(5, 12), rest_seconds=(90, 180),
        gate_movement="pull-up", gate="pass", min_reps=8,
        avoid_blocks=("back-lever",), intense=True,
    ),
    SupportingExercise(
        key="hollow-body-hold", name="Hollow Body Hold", target="hold_seconds",
        pattern="core", equipment=(),
        purpose="Builds the full-body tension and body line used in levers and controlled pulling.",
        setup=("Lie on your back with arms overhead and legs extended.",),
        execution=("Press the lower back into the floor and lift the shoulders and legs slightly.", "Bend the knees to make it easier."),
        common_mistakes=("Letting the lower back lift off the floor.", "Holding the breath."),
        sets=(2, 4), amount=(15, 40), rest_seconds=(45, 90),
        needs_dimension="core",
    ),
    SupportingExercise(
        key="incline-push-up", name="Incline Push-Up", target="reps",
        pattern="push", equipment=(),
        purpose="The easier Push-Up option named in the Push-Up guide; builds pressing volume.",
        setup=("Place the hands on a stable elevated surface with a straight body line.",),
        execution=("Lower the chest toward the surface with control.", "Press back to straight arms."),
        common_mistakes=("Letting the hips sag.", "Flaring the elbows wide."),
        sets=(2, 4), amount=(6, 15), rest_seconds=(60, 120),
        gate_movement="push-up", gate="known", max_reps=10,
    ),
    SupportingExercise(
        key="dip-support-hold", name="Dip Support Hold", target="hold_seconds",
        pattern="push", equipment=("dip_bars",),
        purpose="Builds the stable support position that Dips start from.",
        setup=("Press up on the bars to straight arms.",),
        execution=("Keep the shoulders pressed down away from the ears.", "Hold with a steady body."),
        common_mistakes=("Shrugging the shoulders.", "Locking out with painful elbows."),
        sets=(2, 4), amount=(10, 30), rest_seconds=(60, 120),
        gate_movement="dips", gate="known", max_reps=5,
    ),
    SupportingExercise(
        key="straight-bar-dip", name="Straight-Bar Dip", target="reps",
        pattern="push", equipment=("pull_up_bar",),
        purpose="The straight-bar pressing named in the Muscle-Up guide's easier option.",
        setup=("Use a stable bar you can step up to from a box; start in a straight-arm support above it.",),
        execution=("Lower with control until the bar is near the chest.", "Press back to straight arms."),
        common_mistakes=("Dropping too deep too early.", "Letting the legs swing."),
        sets=(2, 4), amount=(3, 8), rest_seconds=(90, 180),
        gate_movement="dips", gate="pass", min_reps=8,
    ),
)

_BY_KEY = {item.key: item for item in CATALOG}
assert len(_BY_KEY) == len(CATALOG), "Supporting exercise keys must be unique."


def get_supporting_exercise(key: str) -> SupportingExercise | None:
    return _BY_KEY.get(key)


def find_supporting_exercises(text: str) -> list[SupportingExercise]:
    """Exact name or key mentions only; no fuzzy identity."""
    normalized = " " + " ".join(re.sub(r"[^a-z0-9]+", " ", text.lower()).split()) + " "
    return [
        item for item in CATALOG
        if f" {item.name.lower().replace('-', ' ')} " in normalized
        or f" {item.key.replace('-', ' ')} " in normalized
    ]


def public_details(item: SupportingExercise) -> dict:
    """Trusted curated content for plan UI and AI Coach."""
    return {
        "key": item.key,
        "name": item.name,
        "purpose": item.purpose,
        "setup": list(item.setup),
        "execution": list(item.execution),
        "common_mistakes": list(item.common_mistakes),
        "equipment": list(item.equipment),
        "target": item.target,
    }
