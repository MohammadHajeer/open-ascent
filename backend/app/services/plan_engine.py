"""One authoritative planning context for Library, Coach, preflight, and Save.

The context turns athlete evidence into an explicit allowed exercise pool:

    goal path -> canonical movements + supporting exercises
    -> SAF-04 readiness / deterministic applicability -> capability
    -> dosage bounds -> weekly limits

Luna chooses and arranges entries from the pool. Everything here is
deterministic and never consults a model.
"""

from __future__ import annotations

import math
import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import Literal

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.analysis import Analysis
from app.models.movement import Movement
from app.models.movement_documentation import MovementDocumentation
from app.models.profile import Profile
from app.models.readiness_self_report import ReadinessSelfReport
from app.models.training import WorkoutSession, WorkoutSet
from app.schemas.readiness import ReadinessEvidence, ReadinessStatus
from app.services.foundation_readiness import (
    PROVISIONAL_MAX_SETS,
    PROVISIONAL_MAX_TRAINING_DAYS,
    is_provisional_pass,
)
from app.services.goal_paths import PATHS, GoalPath, Role, path_for_goal
from app.services.readiness import ReadinessService
from app.services.readiness_evidence import (
    ASSESSMENT_REP_KEYS,
    ReadinessEvidenceBuilder,
    _target_matched_rep_count,
)
from app.services.supporting_exercises import (
    CATALOG_VERSION,
    SupportingExercise,
    get_supporting_exercise,
)

Basis = Literal["measured_max", "logged_max", "working_sets", "self_report", "threshold", "none"]
Pattern = Literal["vertical_pull", "horizontal_pull", "straight_arm_pull", "push", "core"]
Trend = Literal["improving", "steady", "declining"]

MEASURED_MAX_DAYS = 180
LOGGED_MAX_DAYS = 90
WORKING_SET_DAYS = 42
ONBOARDING_DAYS = 90
MAX_REPS_PER_SET = 25
DEFAULT_TRAINING_DAYS = 4
DEFAULT_SESSION_MINUTES = 90
SECONDS_PER_REP = 4
# Weekly working-set ceilings per pattern group: a guardrail against absurd
# plans, not an optimal-volume claim.
WEEKLY_SET_LIMITS = {"pull": 24, "push": 20, "core": 12}
PROVISIONAL_WEEKLY_SET_LIMITS = {"pull": 18, "push": 15, "core": 12}
BALANCE_SHARE_LIMIT = 0.4

FAMILY_PATTERNS: dict[str, Pattern] = {
    "vertical_pull": "vertical_pull", "muscle_up": "vertical_pull",
    "horizontal_pull": "horizontal_pull", "lever": "straight_arm_pull",
    "inverted_pull": "straight_arm_pull", "horizontal_push": "push",
    "vertical_push": "push",
}
PATTERN_GROUPS = {
    "vertical_pull": "pull", "horizontal_pull": "pull", "straight_arm_pull": "pull",
    "push": "push", "core": "core",
}
PROVISIONAL_BASES = frozenset({"self_report", "threshold"})

EQUIPMENT_REQUIREMENTS = {
    "pull-up": "pull_up_bar", "chin-up": "pull_up_bar",
    "close-grip-pull-up": "pull_up_bar", "wide-grip-pull-up": "pull_up_bar",
    "high-pull-up": "pull_up_bar", "muscle-up": "pull_up_bar",
    "front-lever": "pull_up_bar", "back-lever": "pull_up_bar",
    "inverted-deadlift": "pull_up_bar", "dips": "dip_bars",
}


def equipment_available(slug: str, coaching_context: dict) -> bool:
    required = EQUIPMENT_REQUIREMENTS.get(slug)
    available = set(coaching_context.get("equipment") or [])
    return required is None or required in available or "rings" in available


@dataclass(frozen=True)
class Capability:
    basis: Basis
    value: int | None = None
    trend: Trend | None = None
    sessions: int = 0

    @property
    def effective(self) -> int | None:
        """Capability used for gates and dosage; self-reports are discounted."""
        if self.value is None:
            return None
        if self.basis == "self_report" and self.value >= 2:
            return math.floor(self.value * 0.8)
        return self.value


@dataclass(frozen=True)
class Bounds:
    sets: tuple[int, int]
    amount: tuple[int, int]
    rest_seconds: tuple[int, int]


@dataclass(frozen=True)
class PoolEntry:
    exercise_id: str
    kind: Literal["movement", "supporting"]
    name: str
    role: Role
    pattern: Pattern
    target: Literal["reps", "hold_seconds"]
    bounds: Bounds
    intense: bool
    provisional: bool
    explanation: str
    capability_note: str
    recent_history: bool = False
    trend: Trend | None = None
    movement_id: uuid.UUID | None = None
    supporting_key: str | None = None
    purpose: str | None = None


@dataclass(frozen=True)
class WeeklyLimits:
    max_training_days: int
    min_sets_per_day: int
    max_sets_per_day: int
    weekly_sets: dict[str, int]
    session_minutes: int
    provisional_only: bool


@dataclass(frozen=True)
class MovementDecision:
    movement: Movement
    status: ReadinessStatus
    reasons: list[str]
    evidence: list[ReadinessEvidence]
    avoided: bool
    capability: Capability


@dataclass
class PlanningContext:
    mode: str | None
    path: GoalPath
    goal_slug: str | None
    goal_name: str | None
    pool: dict[str, PoolEntry]
    limits: WeeklyLimits
    decisions: dict[str, MovementDecision]
    excluded: list[dict] = field(default_factory=list)
    goal_status: dict | None = None
    athlete: dict = field(default_factory=dict)

    @property
    def goal_directed(self) -> bool:
        return self.path.key != "general"

    def trains_toward_path(self, entry: PoolEntry) -> bool:
        """Core and balancing work support a plan but cannot carry it alone."""
        return entry.pattern != "core" and not (self.goal_directed and entry.role == "balance")

    @property
    def usable(self) -> bool:
        return any(self.trains_toward_path(entry) for entry in self.pool.values())

    def unavailable_message(self) -> str:
        if self.goal_directed and self.pool:
            return (f"Nothing on the {self.path.name} path can be prescribed yet with your current "
                    "readiness and equipment. Complete the Quick readiness check or log a foundation workout, then try again.")
        return ("No movements currently pass your readiness and equipment checks. Complete the Quick readiness "
                "check for an eligible foundation movement or log a suitable workout, then try again.")


def _utc(value: datetime) -> datetime:
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)


def _avoided_movement_ids(db: Session, profile: Profile) -> set[str]:
    avoided = {str(item) for item in (profile.coaching_context or {}).get("avoid_movement_ids", [])}
    latest: dict[uuid.UUID, str] = {}
    for movement_id, response in db.execute(
        select(ReadinessSelfReport.movement_id, ReadinessSelfReport.response)
        .where(ReadinessSelfReport.user_id == profile.id)
        .order_by(ReadinessSelfReport.reported_at.desc(), ReadinessSelfReport.id.desc())
    ):
        latest.setdefault(movement_id, response)
    return avoided | {str(key) for key, response in latest.items() if response == "avoid"}


def _onboarding_value(profile: Profile, slug: str, now: datetime) -> int | None:
    key = ASSESSMENT_REP_KEYS.get(slug)
    assessment = profile.initial_assessment or {}
    value = ((assessment.get("answers") or {}).get("max_clean_reps") or {}).get(key) if key else None
    if type(value) is not int or value < 0:
        return None
    try:
        submitted = _utc(datetime.fromisoformat(assessment.get("submitted_at")))
    except (TypeError, ValueError):
        return None
    return value if now - timedelta(days=ONBOARDING_DAYS) <= submitted <= now else None


def resolve_capabilities(
    db: Session, profile: Profile, movements: list[Movement],
    evidence: dict[uuid.UUID, list[ReadinessEvidence]], now: datetime,
) -> dict[uuid.UUID, Capability]:
    """Pick one explicit capability basis per movement.

    A recent measured max test outranks a logged one. Recent working sets
    newer than that max test replace it, because they show current capacity.
    Without either, the onboarding self-report is used provisionally, then a
    Quick readiness "able" answer as a threshold-only lower bound.
    """
    ids = [movement.id for movement in movements]
    rows = db.execute(
        select(WorkoutSet, WorkoutSession.started_at, Analysis)
        .join(WorkoutSession, WorkoutSession.id == WorkoutSet.session_id)
        .outerjoin(Analysis, Analysis.id == WorkoutSet.analysis_id)
        .where(
            WorkoutSession.user_id == profile.id,
            WorkoutSet.performer == "self",
            WorkoutSet.movement_id.in_(ids),
            # live_coach sets are user-writable without a verified measurement.
            WorkoutSet.source != "live_coach",
            WorkoutSession.started_at >= now - timedelta(days=MEASURED_MAX_DAYS),
            WorkoutSession.started_at <= now,
        )
    ).all() if ids else []
    observations: dict[uuid.UUID, list[tuple[datetime, int, str, str, uuid.UUID]]] = {}
    for workout_set, started_at, analysis in rows:
        movement = next(item for item in movements if item.id == workout_set.movement_id)
        metric_reps = movement.prescription_type == "repetitions"
        if workout_set.source == "uploaded_analysis":
            if not metric_reps or analysis is None or analysis.user_id != profile.id:
                continue
            value = _target_matched_rep_count(analysis)
            if value is None:
                continue
        else:
            raw = workout_set.reps if metric_reps else workout_set.hold_seconds
            if raw is None:
                continue
            value = int(raw)
        observations.setdefault(workout_set.movement_id, []).append(
            (_utc(started_at), value, workout_set.source, workout_set.intent, workout_set.session_id)
        )

    result: dict[uuid.UUID, Capability] = {}
    for movement in movements:
        items = observations.get(movement.id, [])
        measured = [item for item in items if item[2] == "uploaded_analysis" and item[3] == "max_test"]
        logged = [item for item in items if item[2] != "uploaded_analysis" and item[3] == "max_test"
                  and item[0] >= now - timedelta(days=LOGGED_MAX_DAYS)]
        anchor = max(measured or logged, key=lambda item: item[0], default=None)
        anchor_basis: Basis = "measured_max" if measured else "logged_max"
        working = [item for item in items if item[3] in {"training_set", "assessment"}
                   and item[0] >= now - timedelta(days=WORKING_SET_DAYS)]
        sessions: dict[uuid.UUID, tuple[datetime, int]] = {}
        for started, value, _source, _intent, session_id in working:
            previous = sessions.get(session_id)
            sessions[session_id] = (started, max(value, previous[1] if previous else 0))
        ordered = sorted(sessions.values())
        if ordered and (anchor is None or ordered[-1][0] > anchor[0]):
            current = max(value for _, value in ordered[-2:])
            trend: Trend | None = None
            if len(ordered) >= 2:
                delta = ordered[-1][1] - ordered[0][1]
                trend = "improving" if delta >= 1 else "declining" if delta <= -2 else "steady"
            result[movement.id] = Capability("working_sets", current, trend, len(ordered))
            continue
        if anchor is not None:
            result[movement.id] = Capability(anchor_basis, anchor[1])
            continue
        claimed = _onboarding_value(profile, movement.slug, now) if movement.prescription_type == "repetitions" else None
        if claimed is not None:
            result[movement.id] = Capability("self_report", claimed)
            continue
        threshold = next(
            (int(item.observed_value) for item in evidence.get(movement.id, [])
             if item.source == "structured_self_report" and item.satisfied and item.observed_value),
            None,
        )
        result[movement.id] = Capability("threshold", threshold) if threshold else Capability("none")
    return result


def movement_bounds(movement: Movement, capability: Capability) -> Bounds:
    """Per-set dosage ranges from capability; see the module docstring."""
    provisional = capability.basis in PROVISIONAL_BASES
    sets = (2, PROVISIONAL_MAX_SETS) if provisional or capability.basis == "none" else (2, 5)
    if movement.prescription_type == "duration":
        value = capability.value
        if capability.basis == "working_sets" and value:
            amount = (max(3, value - 5), value + (0 if capability.trend == "declining" else 5))
        elif capability.basis in {"measured_max", "logged_max"} and value:
            amount = (max(3, math.ceil(value * 0.4)), max(3, round(value * 0.7)))
        else:
            amount = (5, 10)
        return Bounds((2, 4), amount, (60, 180))
    effective = capability.effective
    if capability.basis == "working_sets" and effective:
        low = max(1, effective - 2)
        high = effective + (0 if capability.trend == "declining" else 2)
    elif capability.basis in {"measured_max", "logged_max", "self_report"} and effective:
        low = max(1, math.ceil(effective * 0.4))
        high = max(low, round(effective * 0.7))
    elif capability.basis == "threshold" and effective:
        low, high = 1, max(1, effective)
    else:
        low, high = 1, 5
    high = min(high, MAX_REPS_PER_SET)
    return Bounds(sets, (min(low, high), high), (60, 240))


def _capability_note(movement: Movement, capability: Capability) -> str:
    unit = "reps" if movement.prescription_type == "repetitions" else "sec"
    value = capability.value
    return {
        "measured_max": f"Volume is based on your measured max test of {value} {unit}.",
        "logged_max": f"Volume is based on your logged max test of {value} {unit}.",
        "working_sets": f"Progresses from your recent working sets of up to {value} {unit}."
        + (" Held steady because recent sets dipped." if capability.trend == "declining" else ""),
        "self_report": f"Volume is based on your self-reported max of {value} {unit} and stays provisional until you log training.",
        "threshold": f"Starting volume: your readiness answer confirms at least {value} controlled {unit}.",
        "none": f"Introductory volume: readiness is met, but no {movement.name[:60]} performance is recorded yet.",
    }[capability.basis]


def _role_note(role: Role, goal_name: str | None, pattern: Pattern) -> str:
    if role == "goal_specific":
        return f"Part of your {goal_name} path; its readiness requirement is met."
    if role == "balance":
        return "Keeps pulling and pushing balanced alongside your goal work."
    if goal_name:
        return f"Builds the {pattern.replace('_', ' ')} foundation for {goal_name}."
    return "Foundation work for a balanced week."


def _applicability(
    item: SupportingExercise, decisions: dict[str, MovementDecision], equipment: set[str],
    avoided_slugs: set[str], dimensions: dict,
) -> tuple[bool, str]:
    if item.retired:
        return False, "no longer offered"
    if item.equipment and not equipment & set(item.equipment):
        return False, "needs equipment outside your profile"
    blocked = avoided_slugs & ({item.gate_movement} | set(item.avoid_blocks))
    if blocked:
        return False, "you chose to avoid a related movement"
    if item.needs_dimension and dimensions.get(item.needs_dimension) not in {"new", "building", "established"}:
        return False, f"needs your {item.needs_dimension} training experience from onboarding"
    if item.gate_movement is None:
        return True, "applicable"
    decision = decisions.get(item.gate_movement)
    if decision is None:
        return False, "its prerequisite movement is unavailable"
    name = decision.movement.name[:60]
    if item.gate == "pass" and decision.status is not ReadinessStatus.PASS:
        return False, f"needs {name} readiness first"
    if item.gate == "known" and decision.status is ReadinessStatus.UNKNOWN:
        return False, f"needs a {name} readiness answer first"
    effective = decision.capability.effective if decision.status is ReadinessStatus.PASS else None
    if item.min_reps is not None and (effective is None or effective < item.min_reps):
        return False, f"needs about {item.min_reps} controlled {name} reps first"
    if item.max_reps is not None and effective is not None and effective > item.max_reps:
        return False, f"not needed at your {name} level"
    return True, "applicable"


def _supporting_note(item: SupportingExercise, decision: MovementDecision | None, goal_name: str | None) -> str:
    target = f"{goal_name} preparation" if goal_name else "your foundation work"
    if decision is None:
        gate = "Included because you reported training experience in this area."
    elif item.max_reps is not None or decision.status is not ReadinessStatus.PASS:
        gate = f"Chosen while your {decision.movement.name[:60]} is still developing."
    else:
        gate = f"Your {decision.movement.name[:60]} readiness and strength meet its requirement."
    dosage = ("Conservative starting range; Open Ascent does not measure holds yet."
              if item.target == "hold_seconds" else "Curated starting range.")
    return f"Supporting exercise for {target}. {gate} {dosage}"


def _pattern(movement: Movement) -> Pattern:
    return FAMILY_PATTERNS.get(movement.family_key, "vertical_pull")


def build_planning_context(
    db: Session, user_id: uuid.UUID, *, mode: str | None, path_key: str | None = None,
    goal_slug: str | None = None, goal_name: str | None = None, now: datetime | None = None,
) -> PlanningContext:
    now = _utc(now or datetime.now(UTC))
    profile = db.get(Profile, user_id)
    path = PATHS.get(path_key or "") or path_for_goal(goal_slug)
    goal_name = goal_name or (path.name if path.key != "general" else None)
    coaching = (profile.coaching_context or {}) if profile else {}
    answers = ((profile.initial_assessment or {}).get("answers") or {}) if profile else {}
    availability = coaching.get("availability") or {}
    equipment = set(coaching.get("equipment") or [])

    wanted = [slug for slug, _role in path.canonical]
    if goal_slug and goal_slug not in wanted:
        wanted.append(goal_slug)
    wanted += [item.gate_movement for key, _ in path.supporting
               if (item := get_supporting_exercise(key)) and item.gate_movement]
    movements = {m.slug: m for m in db.scalars(select(Movement).where(Movement.slug.in_(set(wanted))))}
    if mode == "progress" and profile is not None:
        recent = db.scalars(
            select(Movement).join(WorkoutSet, WorkoutSet.movement_id == Movement.id)
            .join(WorkoutSession, WorkoutSession.id == WorkoutSet.session_id)
            .where(WorkoutSession.user_id == profile.id, WorkoutSet.performer == "self",
                   WorkoutSession.started_at >= now - timedelta(days=WORKING_SET_DAYS))
        ).unique().all()
        known = {slug for candidate in PATHS.values() for slug, _ in candidate.canonical}
        movements.update({m.slug: m for m in recent if m.slug in known})
    difficulty = {
        doc.movement_id: (doc.content or {}).get("difficulty")
        for doc in db.scalars(select(MovementDocumentation).where(
            MovementDocumentation.movement_id.in_([m.id for m in movements.values()]),
            MovementDocumentation.status == "published",
        ))
    }
    avoided = _avoided_movement_ids(db, profile) if profile else set()
    evidence = {
        m.id: ReadinessEvidenceBuilder.build(db, user_id=user_id, movement_id=m.id)
        for m in movements.values()
    } if profile else {}
    capabilities = resolve_capabilities(db, profile, list(movements.values()), evidence, now) if profile else {}
    decisions: dict[str, MovementDecision] = {}
    for slug, movement in movements.items():
        items = evidence.get(movement.id, [])
        result = ReadinessService.evaluate(items)
        reasons = (result.failed_requirements or result.missing_evidence)[:2] if items else [
            "No trustworthy readiness evidence for this movement yet."
        ]
        decisions[slug] = MovementDecision(
            movement, result.status, reasons,
            evidence.get(movement.id, []), str(movement.id) in avoided,
            capabilities.get(movement.id, Capability("none")),
        )

    roles: dict[str, Role] = dict(path.canonical)
    if goal_slug:
        roles.setdefault(goal_slug, "goal_specific")
    if mode == "progress":
        for slug in movements:
            roles.setdefault(slug, "foundation")
    pool: dict[str, PoolEntry] = {}
    excluded: list[dict] = []
    goal_label = goal_name if path.key != "general" else None
    for slug, role in roles.items():
        decision = decisions.get(slug)
        if decision is None:
            continue
        movement = decision.movement
        if movement.id not in difficulty:
            excluded.append({"name": movement.name[:80], "reason": "has no published movement guide"})
            continue
        if decision.status is not ReadinessStatus.PASS:
            excluded.append({"name": movement.name[:80], "reason": "readiness not met: " + "; ".join(r[:140] for r in decision.reasons)})
            continue
        if movement.prescription_type not in {"repetitions", "duration"}:
            continue
        if not equipment_available(slug, coaching):
            excluded.append({"name": movement.name[:80], "reason": "needs equipment outside your profile"})
            continue
        capability = decision.capability
        provisional = capability.basis in PROVISIONAL_BASES or any(
            is_provisional_pass(item) for item in decision.evidence
        )
        note = _capability_note(movement, capability)
        pool[str(movement.id)] = PoolEntry(
            exercise_id=str(movement.id), kind="movement", name=movement.name[:80], role=role,
            pattern=_pattern(movement),
            target="reps" if movement.prescription_type == "repetitions" else "hold_seconds",
            bounds=movement_bounds(movement, capability),
            intense=difficulty.get(movement.id) == "advanced", provisional=provisional,
            explanation=f"{_role_note(role, goal_label, _pattern(movement))} {note}"[:280],
            capability_note=note, recent_history=capability.basis == "working_sets",
            trend=capability.trend, movement_id=movement.id,
        )
    avoided_slugs = {slug for slug, decision in decisions.items() if decision.avoided}
    for key, role in path.supporting:
        item = get_supporting_exercise(key)
        if item is None:
            continue
        ok, reason = _applicability(item, decisions, equipment, avoided_slugs, answers.get("dimension_stage") or {})
        if not ok:
            if role == "goal_specific":
                excluded.append({"name": item.name, "reason": reason})
            continue
        gate = decisions.get(item.gate_movement) if item.gate_movement else None
        note = _supporting_note(item, gate, goal_label)
        pool[item.key] = PoolEntry(
            exercise_id=item.key, kind="supporting", name=item.name, role=role,
            pattern=item.pattern, target=item.target,
            bounds=Bounds(item.sets, item.amount, item.rest_seconds), intense=item.intense,
            provisional=bool(gate and gate.capability.basis in PROVISIONAL_BASES),
            explanation=note[:280], capability_note=note, supporting_key=item.key,
            purpose=item.purpose,
        )

    canonical_bases = [
        decisions[slug].capability.basis for slug in decisions
        if any(entry.movement_id == decisions[slug].movement.id for entry in pool.values())
    ]
    # A pool without any canonical movement is treated as provisional too.
    provisional_only = all(basis in PROVISIONAL_BASES for basis in canonical_bases)
    days = availability.get("days_per_week")
    max_days = days if isinstance(days, int) and 1 <= days <= 7 else DEFAULT_TRAINING_DAYS
    if provisional_only:
        max_days = min(max_days, PROVISIONAL_MAX_TRAINING_DAYS)
    minutes = availability.get("minutes_per_session")
    limits = WeeklyLimits(
        max_training_days=max_days, min_sets_per_day=3, max_sets_per_day=24,
        weekly_sets=dict(PROVISIONAL_WEEKLY_SET_LIMITS if provisional_only else WEEKLY_SET_LIMITS),
        session_minutes=minutes if isinstance(minutes, int) and minutes > 0 else DEFAULT_SESSION_MINUTES,
        provisional_only=provisional_only,
    )

    goal_status = None
    if goal_slug and goal_slug in decisions:
        decision = decisions[goal_slug]
        prescribable = str(decision.movement.id) in pool
        goal_status = {
            "movement": decision.movement.name[:80],
            "prescribable": prescribable,
            "why_not": None if prescribable else (
                decision.reasons or ["No trustworthy readiness evidence for this movement yet."]
            )[:2],
        }
    skill = answers.get("skill_progression") or {}
    try:
        skill_movement = db.get(Movement, uuid.UUID(str(skill["movement_id"]))) if skill.get("movement_id") else None
    except ValueError:
        skill_movement = None
    athlete = {
        "training_experience": answers.get("training_experience"),
        "primary_goal": coaching.get("primary_goal"),
        "equipment": sorted(equipment),
        "days_per_week": availability.get("days_per_week"),
        "minutes_per_session": availability.get("minutes_per_session"),
    }
    if skill_movement is not None:
        athlete["self_reported_skill_stage"] = {"movement": skill_movement.name[:80], "stage": skill.get("stage")}
    return PlanningContext(
        mode=mode, path=path, goal_slug=goal_slug, goal_name=goal_name, pool=pool,
        limits=limits, decisions=decisions, excluded=excluded[:6], goal_status=goal_status,
        athlete=athlete,
    )


def prompt_payload(context: PlanningContext) -> dict:
    """Compact, model-facing planning context; data, never instructions."""
    limits = context.limits
    payload: dict = {
        "mode": context.mode or "coach_request",
        "athlete": context.athlete,
        "training_path": {"name": context.path.name, "emphasis": context.path.emphasis,
                          "goal": context.goal_name if context.goal_directed else None},
        "allowed_exercises": [
            {
                "exercise_id": entry.exercise_id, "name": entry.name,
                "kind": "supported_movement" if entry.kind == "movement" else "supporting_exercise",
                "role": entry.role, "pattern": entry.pattern, "target": entry.target,
                "sets": list(entry.bounds.sets), entry.target: list(entry.bounds.amount),
                "rest_seconds": list(entry.bounds.rest_seconds), "intense": entry.intense,
                "capability_basis": entry.capability_note,
                **({"purpose": entry.purpose} if entry.purpose else {}),
                **({"trend": entry.trend} if entry.trend else {}),
            }
            for entry in context.pool.values()
        ],
        "weekly_limits": {
            "max_training_days": limits.max_training_days,
            "working_sets_per_day": [limits.min_sets_per_day, limits.max_sets_per_day],
            "max_weekly_sets_by_pattern_group": limits.weekly_sets,
            "pattern_groups": {"pull": ["vertical_pull", "horizontal_pull", "straight_arm_pull"],
                               "push": ["push"], "core": ["core"]},
            "session_minutes": limits.session_minutes,
            "evidence": "provisional self-report only" if limits.provisional_only else "includes logged or measured evidence",
        },
        "catalog_version": CATALOG_VERSION,
    }
    if context.goal_status:
        payload["goal_movement"] = context.goal_status
    if context.excluded:
        payload["not_yet_available"] = context.excluded
    return payload
