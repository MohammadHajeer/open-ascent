"""Add provisional foundation readiness answers and opt in pristine guides.

Revision ID: b71e2c934af0
Revises: ae5270d19c4b
"""

import json
from copy import deepcopy

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "b71e2c934af0"
down_revision = "ae5270d19c4b"
branch_labels = None
depends_on = None

FOUNDATIONS = {
    "pull-up": ("recent_logged_pull_up", 1),
    "push-up": ("recent_logged_push_up", 5),
    "dips": ("recent_logged_dips", 1),
}


def upgrade() -> None:
    op.create_table(
        "readiness_self_reports",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("profiles.id", ondelete="CASCADE"), nullable=False),
        sa.Column("movement_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("movements.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("documentation_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("movement_documentation.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("rule_code", sa.Text(), nullable=False),
        sa.Column("source", sa.Text(), nullable=False, server_default="structured_self_report"),
        sa.Column("response", sa.Text(), nullable=False),
        sa.Column("reported_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.CheckConstraint("response IN ('able', 'not_yet', 'avoid')", name="ck_readiness_self_reports_response"),
        sa.CheckConstraint("source = 'structured_self_report'", name="ck_readiness_self_reports_source"),
    )
    op.create_index("ix_readiness_self_reports_owner_rule", "readiness_self_reports", ["user_id", "movement_id", "rule_code", "reported_at"])

    connection = op.get_bind()
    for slug, (code, threshold) in FOUNDATIONS.items():
        row = connection.execute(sa.text("""
            SELECT movement.id AS movement_id, doc.id AS documentation_id, doc.content
            FROM movements AS movement
            JOIN movement_documentation AS doc ON doc.movement_id = movement.id
            WHERE movement.slug = :slug AND doc.status = 'published'
              AND doc.created_by IS NULL AND doc.published_by IS NULL
              AND NOT EXISTS (SELECT 1 FROM movement_documentation AS draft
                              WHERE draft.movement_id = movement.id AND draft.status = 'draft')
            FOR UPDATE OF movement, doc
        """), {"slug": slug}).mappings().first()
        if row is None:
            continue
        content = row["content"]
        rules = content.get("readiness_rules") or []
        if len(rules) != 1 or rules[0].get("code") != code or rules[0].get("movement_id") != str(row["movement_id"]):
            continue
        rule = rules[0]
        if (rule.get("accepted_sources") != ["manual", "uploaded_analysis"]
                or str(rule.get("value")) not in {str(threshold), f"{threshold}.0"}
                or rule.get("max_age_days") != 90):
            continue
        index = rule["prerequisite_index"]
        if index >= len(content.get("prerequisites") or []) or "logged in the last 90 days" not in content["prerequisites"][index]:
            continue
        updated = deepcopy(content)
        updated["prerequisites"][index] = (
            f"At least {threshold} controlled {slug.replace('-', ' ').title()} repetition{'s' if threshold != 1 else ''}, "
            "supported by recent training or a structured self-report"
        )
        updated["readiness_rules"][0]["accepted_sources"].append("structured_self_report")
        next_version = connection.execute(sa.text("SELECT COALESCE(MAX(version), 0) + 1 FROM movement_documentation WHERE movement_id = :id"), {"id": row["movement_id"]}).scalar_one()
        connection.execute(sa.text("UPDATE movement_documentation SET status = 'archived', updated_at = now() WHERE id = :id"), {"id": row["documentation_id"]})
        connection.execute(sa.text("""
            INSERT INTO movement_documentation (movement_id, version, status, content, published_at, created_by, published_by, edit_revision)
            VALUES (:movement_id, :version, 'published', CAST(:content AS jsonb), now(), NULL, NULL, 1)
        """), {"movement_id": row["movement_id"], "version": next_version, "content": json.dumps(updated)})


def downgrade() -> None:
    connection = op.get_bind()
    for slug, (code, _threshold) in FOUNDATIONS.items():
        row = connection.execute(sa.text("""
            SELECT movement.id AS movement_id, doc.id AS documentation_id,
                   doc.version, doc.content
            FROM movements AS movement
            JOIN movement_documentation AS doc ON doc.movement_id = movement.id
            WHERE movement.slug = :slug AND doc.status = 'published'
              AND doc.created_by IS NULL AND doc.published_by IS NULL
            FOR UPDATE OF movement, doc
        """), {"slug": slug}).mappings().first()
        if row is None:
            continue
        rules = row["content"].get("readiness_rules") or []
        if len(rules) != 1 or rules[0].get("code") != code or "structured_self_report" not in rules[0].get("accepted_sources", []):
            continue
        previous = connection.execute(sa.text("""
            SELECT id, content FROM movement_documentation
            WHERE movement_id = :movement_id AND status = 'archived' AND version < :version
            ORDER BY version DESC LIMIT 1
        """), {"movement_id": row["movement_id"], "version": row["version"]}).mappings().first()
        if previous is None:
            continue
        previous_rules = previous["content"].get("readiness_rules") or []
        if len(previous_rules) != 1 or previous_rules[0].get("code") != code or "structured_self_report" in previous_rules[0].get("accepted_sources", []):
            continue
        connection.execute(sa.text("UPDATE movement_documentation SET status = 'archived', updated_at = now() WHERE id = :id"), {"id": row["documentation_id"]})
        connection.execute(sa.text("UPDATE movement_documentation SET status = 'published', updated_at = now() WHERE id = :id"), {"id": previous["id"]})
    remaining = connection.execute(sa.text("""
        SELECT COUNT(*) FROM movement_documentation
        WHERE status = 'published' AND content::text LIKE '%structured_self_report%'
    """)).scalar_one()
    if remaining:
        raise RuntimeError("A published guide still accepts structured self-report; revise it before downgrading.")
    op.drop_index("ix_readiness_self_reports_owner_rule", table_name="readiness_self_reports")
    op.drop_table("readiness_self_reports")
