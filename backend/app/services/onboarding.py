from __future__ import annotations

from datetime import datetime

from app.schemas.onboarding import AssessmentAnswers

LEVEL_BY_STAGE = {
    "new": "foundation",
    "building": "developing",
    "established": "established",
    "unknown": "unknown",
}
LEVEL_BY_EXPERIENCE = {
    "new": "foundation",
    "some": "developing",
    "regular": "established",
    "unknown": "unknown",
}
DIMENSIONS = ("pulling", "pushing", "core", "balance", "statics")


def build_assessment(answers: AssessmentAnswers, submitted_at: datetime) -> dict:
    stages = answers.dimension_stage.model_dump()
    return {
        "schema_version": 1,
        "questionnaire_version": "auth01-v1",
        "rubric_version": "self-report-v1",
        "submitted_at": submitted_at.isoformat(),
        "answers": answers.model_dump(mode="json"),
        "baseline": {
            "overall_level": LEVEL_BY_EXPERIENCE[answers.training_experience],
            "dimension_levels": {
                dimension: LEVEL_BY_STAGE[stages[dimension]] for dimension in DIMENSIONS
            },
        },
    }


REP_CAPABILITIES = {"pull-up": "pull_up", "push-up": "push_up", "dips": "dips"}


def derive_athlete_state(
    initial_assessment: dict, movement_ids: dict[str, str] | None = None
) -> dict:
    baseline = initial_assessment["baseline"]
    as_of = initial_assessment["submitted_at"]
    dimensions = {}
    for dimension in DIMENSIONS:
        level = baseline["dimension_levels"][dimension]
        evidence = [f"initial_assessment.answers.dimension_stage.{dimension}"]
        if dimension == "pulling":
            evidence.append("initial_assessment.answers.max_clean_reps.pull_up")
        elif dimension == "pushing":
            evidence.extend(
                (
                    "initial_assessment.answers.max_clean_reps.push_up",
                    "initial_assessment.answers.max_clean_reps.dips",
                )
            )
        dimensions[dimension] = {
            "level": level,
            "source": "self_reported",
            "confidence": "unknown" if level == "unknown" else "provisional",
            "observed_at": as_of,
            "evidence_refs": evidence,
        }
    reported_reps = (initial_assessment.get("answers") or {}).get(
        "max_clean_reps"
    ) or {}
    capabilities = {}
    for slug, answer_key in REP_CAPABILITIES.items():
        value = reported_reps.get(answer_key)
        movement_id = (movement_ids or {}).get(slug)
        if type(value) is int and movement_id is not None:
            capabilities[movement_id] = {
                "movement_id": movement_id,
                "movement_slug": slug,
                "metric": "reps",
                "intent": "max_test",
                "value": value,
                "source": "self_reported",
                "confidence": "provisional",
                "observed_at": as_of,
                "evidence_refs": [
                    f"initial_assessment.answers.max_clean_reps.{answer_key}"
                ],
            }
    return {
        "schema_version": 1,
        "overall_level": baseline["overall_level"],
        "overall_source": "self_reported",
        "dimensions": dimensions,
        "capabilities": capabilities,
        "updated_at": as_of,
    }
