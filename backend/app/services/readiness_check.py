"""Unmetered, owner-scoped preflight for foundation readiness questions."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.movement import Movement
from app.models.profile import Profile
from app.models.readiness_self_report import ReadinessSelfReport
from app.schemas.movement_safety import MovementSafetyContent
from app.schemas.plan_generation import LibraryPlanRequest
from app.schemas.readiness import ReadinessStatus
from app.schemas.readiness_check import ReadinessAnswersInput
from app.services.foundation_readiness import permits_structured_self_report
from app.services.movement_documentation import MovementDocumentationService
from app.services.plan_modes import (
    equipment_available,
    normalize_request,
    planning_context,
)
from app.services.readiness import ReadinessService
from app.services.readiness_evidence import ReadinessEvidenceBuilder


def _candidate_slugs(request: LibraryPlanRequest, db: Session) -> tuple[str, ...]:
    if request.mode == "profile":
        return ("push-up", "pull-up", "dips")
    if request.mode == "progress":
        return ()
    if request.goal_focus:
        return ("pull-up",)
    goal = db.get(Movement, request.goal_movement_id)
    if goal is None:
        return ()
    if goal.slug in {"muscle-up"}:
        return ("pull-up", "dips")
    if goal.slug in {"pull-up", "high-pull-up", "chin-up", "front-lever", "back-lever", "inverted-deadlift", "close-grip-pull-up", "wide-grip-pull-up"}:
        return ("pull-up",)
    if goal.slug == "dips":
        return ("dips",)
    if goal.slug == "push-up":
        return ("push-up",)
    return ("push-up", "pull-up", "dips")


def _published_question(db: Session, movement: Movement) -> dict | None:
    doc = MovementDocumentationService.get_published(db, movement.id)
    if doc is None:
        return None
    try:
        safety = MovementSafetyContent.model_validate(doc.content)
    except ValidationError:
        return None
    rules = [rule for rule in safety.readiness_rules or [] if permits_structured_self_report(movement, safety, rule)]
    if len(rules) != 1:
        return None
    rule = rules[0]
    count = int(rule.value)
    return {
        "movement_id": str(movement.id), "documentation_id": str(doc.id),
        "rule_code": rule.code, "movement_name": movement.name[:80],
        "requirement": safety.prerequisites[rule.prerequisite_index][:180],
        "question": f"Can you perform at least {count} controlled {movement.name[:80]} repetition{'s' if count != 1 else ''} without pain?",
    }


def preflight(db: Session, user_id: uuid.UUID, request: LibraryPlanRequest) -> dict:
    # Validate goal/progress before considering any metered generation.
    _content, metadata = normalize_request(db, user_id, request)
    if request.mode == "progress":
        return {"status": "ready", "questions": []}
    profile = db.get(Profile, user_id)
    context = profile.coaching_context or {} if profile else {}
    questions = []
    retry_questions = []
    for slug in _candidate_slugs(request, db):
        movement = db.scalar(select(Movement).where(Movement.slug == slug))
        if movement is None or not equipment_available(slug, context):
            continue
        question = _published_question(db, movement)
        if question is None:
            continue
        retry_questions.append(question)
        decision = ReadinessService.evaluate(ReadinessEvidenceBuilder.build(
            db, user_id=user_id, movement_id=movement.id
        ))
        already_answered = db.scalar(select(ReadinessSelfReport.id).where(
            ReadinessSelfReport.user_id == user_id,
            ReadinessSelfReport.movement_id == movement.id,
            ReadinessSelfReport.documentation_id == uuid.UUID(question["documentation_id"]),
            ReadinessSelfReport.rule_code == question["rule_code"],
            ReadinessSelfReport.reported_at >= datetime.now(UTC) - timedelta(days=90),
        ).limit(1))
        if decision.status is ReadinessStatus.UNKNOWN and not already_answered:
            questions.append(question)
    if questions:
        return {"status": "check_required", "questions": questions}
    # The same planning engine that generation and Save use decides whether a
    # coherent plan exists, so a metered request is never admitted without one.
    context = planning_context(db, user_id, metadata)
    if context.usable:
        return {"status": "ready", "questions": []}
    return {"status": "unavailable", "questions": retry_questions, "message": context.unavailable_message()}


def store_answers(db: Session, user_id: uuid.UUID, payload: ReadinessAnswersInput) -> None:
    validated = []
    for answer in payload.answers:
        movement = db.get(Movement, answer.movement_id)
        doc = MovementDocumentationService.get_published(db, answer.movement_id)
        if movement is None or doc is None or doc.id != answer.documentation_id:
            raise ValueError("The readiness question changed. Reload it before answering.")
        question = _published_question(db, movement)
        if question is None or question["rule_code"] != answer.rule_code:
            raise ValueError("This movement does not accept a structured readiness answer.")
        validated.append(ReadinessSelfReport(
            user_id=user_id, movement_id=movement.id, documentation_id=doc.id,
            rule_code=answer.rule_code, response=answer.response,
            source="structured_self_report",
        ))
    db.add_all(validated)
    db.commit()
