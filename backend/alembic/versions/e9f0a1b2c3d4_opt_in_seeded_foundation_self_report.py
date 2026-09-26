"""Opt demo-seeded foundation guides into provisional structured self-report.

b71e2c934af0 opted in only pristine seed guides. Guides published by
scripts/seed_demo.py carry an administrator identity, so that migration left
them accepting only logged or analyzed evidence. With no published rule that
accepts a structured self-report, a new athlete received no Quick readiness
questions and could never reach a starter plan.

Only guides whose rule and prerequisite text match the demo seed output
exactly are revised, through the normal archive-and-publish versioning.
Guides an administrator has edited in any way are left untouched.

Revision ID: e9f0a1b2c3d4
Revises: d8e9f0a1b2c3
"""

import json
from copy import deepcopy

import sqlalchemy as sa
from alembic import op

revision = "e9f0a1b2c3d4"
down_revision = "d8e9f0a1b2c3"
branch_labels = None
depends_on = None

FOUNDATIONS = {
    "pull-up": ("recent_logged_pull_up", 1),
    "push-up": ("recent_logged_push_up", 5),
    "dips": ("recent_logged_dips", 1),
}
LEGACY_SOURCES = ["manual", "uploaded_analysis"]


def _plural(threshold: int) -> str:
    return "s" if threshold != 1 else ""


def _seeded_prerequisite(name: str, threshold: int) -> str:
    return (
        f"At least {threshold} self-performed {name} repetition{_plural(threshold)} "
        "logged in the last 90 days"
    )


def _opted_in_prerequisite(name: str, threshold: int) -> str:
    return (
        f"At least {threshold} controlled {name} repetition{_plural(threshold)}, "
        "supported by recent training or a structured self-report"
    )


def _is_legacy_seed_rule(content: dict, movement_id, name: str, code: str, threshold: int) -> bool:
    rules = content.get("readiness_rules") or []
    if len(rules) != 1:
        return False
    rule = rules[0]
    prerequisites = content.get("prerequisites") or []
    index = rule.get("prerequisite_index")
    return (
        rule.get("code") == code
        and rule.get("type") == "movement_performance"
        and rule.get("movement_id") == str(movement_id)
        and rule.get("metric") == "reps"
        and rule.get("operator") == ">="
        and str(rule.get("value")) in {str(threshold), f"{threshold}.0"}
        and rule.get("max_age_days") == 90
        and rule.get("accepted_sources") == LEGACY_SOURCES
        and isinstance(index, int)
        and index == len(prerequisites) - 1
        and prerequisites[index] == _seeded_prerequisite(name, threshold)
    )


def upgrade() -> None:
    connection = op.get_bind()
    for slug, (code, threshold) in FOUNDATIONS.items():
        row = connection.execute(sa.text("""
            SELECT movement.id AS movement_id, movement.name AS name,
                   doc.id AS documentation_id, doc.content AS content
            FROM movements AS movement
            JOIN movement_documentation AS doc ON doc.movement_id = movement.id
            WHERE movement.slug = :slug AND doc.status = 'published'
              AND movement.prescription_type = 'repetitions'
              AND NOT EXISTS (SELECT 1 FROM movement_documentation AS draft
                              WHERE draft.movement_id = movement.id AND draft.status = 'draft')
            FOR UPDATE OF movement, doc
        """), {"slug": slug}).mappings().first()
        if row is None or not _is_legacy_seed_rule(
            row["content"], row["movement_id"], row["name"], code, threshold
        ):
            continue
        updated = deepcopy(row["content"])
        index = updated["readiness_rules"][0]["prerequisite_index"]
        updated["prerequisites"][index] = _opted_in_prerequisite(row["name"], threshold)
        updated["readiness_rules"][0]["accepted_sources"] = [
            *LEGACY_SOURCES, "structured_self_report",
        ]
        next_version = connection.execute(sa.text(
            "SELECT COALESCE(MAX(version), 0) + 1 FROM movement_documentation WHERE movement_id = :id"
        ), {"id": row["movement_id"]}).scalar_one()
        connection.execute(sa.text(
            "UPDATE movement_documentation SET status = 'archived', updated_at = now() WHERE id = :id"
        ), {"id": row["documentation_id"]})
        connection.execute(sa.text("""
            INSERT INTO movement_documentation
                (movement_id, version, status, content, published_at, created_by, published_by, edit_revision)
            VALUES (:movement_id, :version, 'published', CAST(:content AS jsonb), now(), NULL, NULL, 1)
        """), {
            "movement_id": row["movement_id"],
            "version": next_version,
            "content": json.dumps(updated),
        })


def downgrade() -> None:
    connection = op.get_bind()
    for slug, (code, threshold) in FOUNDATIONS.items():
        row = connection.execute(sa.text("""
            SELECT movement.id AS movement_id, movement.name AS name,
                   doc.id AS documentation_id, doc.version, doc.content
            FROM movements AS movement
            JOIN movement_documentation AS doc ON doc.movement_id = movement.id
            WHERE movement.slug = :slug AND doc.status = 'published'
              AND doc.created_by IS NULL AND doc.published_by IS NULL
            FOR UPDATE OF movement, doc
        """), {"slug": slug}).mappings().first()
        if row is None:
            continue
        previous = connection.execute(sa.text("""
            SELECT id, content FROM movement_documentation
            WHERE movement_id = :movement_id AND status = 'archived' AND version < :version
              AND created_by IS NOT NULL
            ORDER BY version DESC LIMIT 1
        """), {"movement_id": row["movement_id"], "version": row["version"]}).mappings().first()
        # Revert only the exact revision this migration published.
        if previous is None or not _is_legacy_seed_rule(
            previous["content"], row["movement_id"], row["name"], code, threshold
        ):
            continue
        expected = deepcopy(previous["content"])
        index = expected["readiness_rules"][0]["prerequisite_index"]
        expected["prerequisites"][index] = _opted_in_prerequisite(row["name"], threshold)
        expected["readiness_rules"][0]["accepted_sources"] = [
            *LEGACY_SOURCES, "structured_self_report",
        ]
        if row["content"] != expected:
            continue
        connection.execute(sa.text(
            "UPDATE movement_documentation SET status = 'archived', updated_at = now() WHERE id = :id"
        ), {"id": row["documentation_id"]})
        connection.execute(sa.text(
            "UPDATE movement_documentation SET status = 'published', updated_at = now() WHERE id = :id"
        ), {"id": previous["id"]})
