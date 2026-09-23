"""Small, read-only Coach tool registry and explicitly bounded output DTOs."""

from __future__ import annotations

import json
import uuid
from collections.abc import Callable
from dataclasses import dataclass

from pydantic import ValidationError
from sqlalchemy.orm import Session

from app.schemas.coach_tools import (
    AnalysisDetailArguments,
    MovementGuideArguments,
    ProfileArguments,
    ProgressArguments,
    RecentAnalysesArguments,
    RecentWorkoutsArguments,
    SearchMovementsArguments,
    ToolArguments,
)
from app.services import analysis as analysis_service
from app.services import workout as workout_service
from app.services.coach_context import get_athlete_profile_context
from app.services.movement import MovementService
from app.services.movement_documentation import MovementDocumentationService
from app.services.progress import get_progress_summary

MAX_TOOL_ROUNDS_PER_RESPONSE = 3
MAX_TOOL_CALLS_PER_RESPONSE = 6
MAX_REP_DETAILS = 12
MAX_TOOL_ARGUMENT_CHARS = 2048
MAX_TOOL_OUTPUT_CHARS = 16000


@dataclass(frozen=True)
class CoachToolContext:
    user_id: uuid.UUID


@dataclass(frozen=True)
class ToolDefinition:
    name: str
    description: str
    arguments: type[ToolArguments]
    execute: Callable[[Session, CoachToolContext, ToolArguments], dict]

    def openai_schema(self) -> dict:
        return {
            "type": "function",
            "name": self.name,
            "description": self.description,
            "parameters": self.arguments.model_json_schema(),
            "strict": False,
        }


def _text(value: object, maximum: int = 180) -> str:
    return str(value or "")[:maximum]


def _texts(value: object, count: int = 6, maximum: int = 180) -> list[str]:
    return (
        [_text(item, maximum) for item in value[:count] if isinstance(item, str)]
        if isinstance(value, list)
        else []
    )


def _simple_fields(value: object, allowed: tuple[str, ...]) -> dict:
    if not isinstance(value, dict):
        return {}
    return {
        key: _text(item, 80) if isinstance(item, str) else item
        for key in allowed
        if (item := value.get(key)) is not None
        and isinstance(item, (str, int, float, bool))
    }


def _movement(db: Session, value: str | None):
    if value is None:
        return None
    return MovementService.resolve_coach_movement(db, value)


def _profile(db: Session, context: CoachToolContext, _args: ProfileArguments) -> dict:
    return get_athlete_profile_context(db, context.user_id) or {
        "error": "profile_not_found"
    }


def _workouts(
    db: Session, context: CoachToolContext, args: RecentWorkoutsArguments
) -> dict:
    movement = _movement(db, args.movement)
    if args.movement and movement is None:
        return {"error": "movement_not_found"}
    sessions = workout_service.list_recent_coach_sessions(
        db, context.user_id, movement.id if movement else None, args.limit
    )
    return {
        "sessions": [
            {
                "started_at": session.started_at.isoformat(),
                "completed_at": session.completed_at.isoformat()
                if session.completed_at
                else None,
                "source": session.source,
                "sets": [
                    {
                        "movement": name[:80],
                        "position": item.position,
                        "performer": item.performer,
                        "source": item.source,
                        "intent": item.intent,
                        "reps": item.reps,
                        "hold_seconds": float(item.hold_seconds)
                        if item.hold_seconds is not None
                        else None,
                        "analysis_linked": item.analysis_id is not None,
                    }
                    for item, name in sets
                ],
            }
            for session, sets in sessions
        ]
    }


def _progress(db: Session, context: CoachToolContext, args: ProgressArguments) -> dict:
    movement = _movement(db, args.movement)
    if args.movement and movement is None:
        return {"error": "movement_not_found"}
    summary = get_progress_summary(db, context.user_id)
    selected = [item for item in summary.movements if item.metrics]
    if movement:
        selected = [item for item in summary.movements if item.id == movement.id]
    return {
        "consistency_scope": "all self-attributed workout sets",
        "consistency": summary.consistency.model_dump(mode="json"),
        "movements": [
            {
                "name": item.name[:80],
                "metrics": [
                    {
                        "measurement": metric.measurement,
                        "unit": metric.unit,
                        "points": [
                            {
                                "recorded_at": point.recorded_at.isoformat(),
                                "value": point.value,
                                "source": point.source,
                                "intent": point.intent,
                            }
                            for point in metric.points[-10:]
                        ],
                    }
                    for metric in item.metrics
                ],
            }
            for item in selected[:5]
        ],
    }


def _analysis_summary(item, movement) -> dict:
    result = (
        item.result
        if item.status == "completed" and isinstance(item.result, dict)
        else {}
    )
    reps = result.get("reps") if isinstance(result.get("reps"), list) else []
    return {
        "analysis_id": str(item.id),
        "movement": movement.name[:80] if movement else "Any Vertical Pull",
        "status": item.status,
        "completed_at": item.completed_at.isoformat() if item.completed_at else None,
        "outcome": _text(result.get("outcome") or item.terminal_outcome, 60),
        "valid_rep_count": item.valid_rep_count,
        "partial_rep_count": item.partial_rep_count,
        "uncertain_rep_count": item.uncertain_rep_count,
        "major_findings": [
            finding
            for rep in reps[:3]
            if isinstance(rep, dict)
            for finding in _texts(rep.get("technique_findings"), 2, 140)
        ][:4],
        "analyzer_version": _text(item.analyzer_version, 60),
    }


def _analyses(
    db: Session, context: CoachToolContext, args: RecentAnalysesArguments
) -> dict:
    movement = _movement(db, args.movement)
    if args.movement and movement is None:
        return {"error": "movement_not_found"}
    analyses = analysis_service.list_recent_owned_analyses(
        db, context.user_id, movement.id if movement else None, args.limit
    )
    movements = {
        item.movement_id: _movement_by_id(db, item.movement_id)
        for item in analyses
        if item.movement_id
    }
    return {
        "analyses": [
            _analysis_summary(item, movements.get(item.movement_id))
            for item in analyses
        ],
        "evidence_note": "Standalone uploads are not automatically personal workout progress.",
    }


def _movement_by_id(db: Session, movement_id: uuid.UUID):
    from app.models.movement import Movement

    return db.get(Movement, movement_id)


def _detail(
    db: Session, context: CoachToolContext, args: AnalysisDetailArguments
) -> dict:
    item = analysis_service.get_owned_authenticated_analysis(
        db, context.user_id, args.analysis_id
    )
    if item is None:
        return {"error": "analysis_not_found"}
    movement = _movement_by_id(db, item.movement_id) if item.movement_id else None
    summary = _analysis_summary(item, movement)
    result = (
        item.result
        if item.status == "completed" and isinstance(item.result, dict)
        else {}
    )
    evidence = (
        result.get("evidence") if isinstance(result.get("evidence"), dict) else {}
    )
    reps = result.get("reps") if isinstance(result.get("reps"), list) else []
    summary["tracking_quality"] = {
        "usable_pose_ratio": evidence.get("usable_pose_ratio")
        if isinstance(evidence.get("usable_pose_ratio"), (int, float))
        else None,
        "reason_codes": _texts(evidence.get("reason_codes"), 6, 80),
    }
    summary["rep_details"] = [
        {
            "rep_index": rep.get("rep_index"),
            "outcome": _text(rep.get("outcome"), 40),
            "reason_codes": _texts(rep.get("reason_codes"), 5, 80),
            "technique_findings": _texts(rep.get("technique_findings"), 5, 180),
            "form_quality": _simple_fields(
                rep.get("form_quality"),
                (
                    "bottom_extension",
                    "bottom_extension_symmetry",
                    "knee_bend",
                    "leg_separation",
                    "lower_body_asymmetry",
                    "forward_leg_movement",
                    "swing",
                    "body_line_control",
                ),
            ),
            "tempo": _simple_fields(
                rep.get("tempo"),
                (
                    "ascent_ms",
                    "top_transition_ms",
                    "descent_ms",
                    "total_ms",
                    "descent_control",
                    "descent_monotonic_ratio",
                ),
            ),
        }
        for rep in reps[:MAX_REP_DETAILS]
        if isinstance(rep, dict)
    ]
    summary["rep_details_truncated"] = len(reps) > MAX_REP_DETAILS
    set_summary = result.get("set_summary")
    summary["set_summary"] = _simple_fields(
        set_summary,
        (
            "execution_intent",
            "next_set_focus",
        ),
    )
    if isinstance(set_summary, dict):
        summary["set_summary"]["tempo"] = _simple_fields(
            set_summary.get("tempo"),
            (
                "state",
                "average_total_ms",
                "average_ascent_ms",
                "average_descent_ms",
                "variability_cv",
                "trend",
                "ascent_trend",
                "descent_trend",
                "intent_alignment",
            ),
        )
    return summary


def _guide(
    db: Session, _context: CoachToolContext, args: MovementGuideArguments
) -> dict:
    movement = _movement(db, args.movement)
    if movement is None:
        return {"error": "movement_not_found"}
    documentation = MovementDocumentationService.get_published(db, movement.id)
    if documentation is None:
        return {"error": "movement_guide_not_found"}
    content = documentation.content or {}
    return {
        "movement": {"name": movement.name[:80], "slug": movement.slug[:80]},
        "documentation_status": "published",
        "safety": {
            key: _texts(content.get(key), 12, 400)
            for key in (
                "stressed_areas",
                "prerequisites",
                "cautions",
                "stop_conditions",
                "setup",
            )
            if key in content
        }
        | {
            key: _text(content.get(key), 500)
            for key in ("notice", "difficulty", "easier_option")
            if key in content
        },
    }


def _search(
    db: Session, _context: CoachToolContext, args: SearchMovementsArguments
) -> dict:
    return {
        "movements": [
            {"id": str(item.id), "name": item.name[:80], "slug": item.slug[:80]}
            for item in MovementService.search_coach_movements(
                db, args.query, args.limit
            )
        ]
    }


TOOL_REGISTRY = {
    item.name: item
    for item in (
        ToolDefinition(
            "get_athlete_profile_context",
            "Read this athlete's self-reported onboarding profile and labelled athlete state.",
            ProfileArguments,
            _profile,
        ),
        ToolDefinition(
            "get_recent_workouts",
            "Read this athlete's recent self-attributed workout sets with source and intent labels.",
            RecentWorkoutsArguments,
            _workouts,
        ),
        ToolDefinition(
            "get_progress_summary",
            "Read the existing personal consistency and separate rep or hold trends; prefer this for progress questions.",
            ProgressArguments,
            _progress,
        ),
        ToolDefinition(
            "get_recent_analyses",
            "List this athlete's authenticated uploaded analyses; standalone uploads are not workout progress.",
            RecentAnalysesArguments,
            _analyses,
        ),
        ToolDefinition(
            "get_analysis_detail",
            "Read bounded deterministic findings for one owned authenticated analysis.",
            AnalysisDetailArguments,
            _detail,
        ),
        ToolDefinition(
            "get_movement_guide",
            "Read currently published movement technique and safety guidance.",
            MovementGuideArguments,
            _guide,
        ),
        ToolDefinition(
            "search_movements",
            "Resolve partial or informal movement names to canonical names and slugs.",
            SearchMovementsArguments,
            _search,
        ),
    )
}


def openai_tools() -> list[dict]:
    return [item.openai_schema() for item in TOOL_REGISTRY.values()]


def execute_tool(
    db: Session, context: CoachToolContext, name: str, raw_arguments: str
) -> str:
    definition = TOOL_REGISTRY.get(name)
    if definition is None:
        return json.dumps({"error": "unknown_tool"})
    if not isinstance(raw_arguments, str) or len(raw_arguments) > MAX_TOOL_ARGUMENT_CHARS:
        return json.dumps({"error": "invalid_arguments"})
    try:
        parsed = json.loads(raw_arguments)
        arguments = definition.arguments.model_validate(parsed)
    except (ValueError, TypeError, ValidationError):
        return json.dumps({"error": "invalid_arguments"})
    result = definition.execute(db, context, arguments)
    output = json.dumps(result, separators=(",", ":"), default=str)
    return (
        output
        if len(output) <= MAX_TOOL_OUTPUT_CHARS
        else json.dumps({"error": "result_too_large"})
    )
