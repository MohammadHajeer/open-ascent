"""Publish conservative progression evidence rules on pristine seed guides.

Revision ID: c7e8f9a0b123
Revises: c6d7e8f9a012
"""

import json
from copy import deepcopy

import sqlalchemy as sa
from alembic import op

revision = "c7e8f9a0b123"
down_revision = "c6d7e8f9a012"
branch_labels = None
depends_on = None


# Copy exact seed prerequisite lists here so this migration remains stable if
# the seed catalog changes. Admin-authored guides and drafts are never touched.
CURATED = {
    "close-grip-pull-up": (
        [
            "Comfortable standard pull-up technique",
            "Secure grip strength",
            "Pain-free close-grip hanging position",
        ],
        [("one_verified_pull_up_rep", "pull-up", "At least one analyzer-confirmed Pull-Up repetition")],
    ),
    "wide-grip-pull-up": (
        [
            "Comfortable standard pull-ups",
            "Adequate overhead shoulder mobility",
            "Secure grip strength",
        ],
        [("one_verified_pull_up_rep", "pull-up", "At least one analyzer-confirmed Pull-Up repetition")],
    ),
    "high-pull-up": (
        [
            "Consistent strict pull-ups",
            "Strong scapular control",
            "Ability to pull explosively without losing body control",
        ],
        [("one_verified_pull_up_rep", "pull-up", "At least one analyzer-confirmed Pull-Up repetition")],
    ),
    "muscle-up": (
        [
            "Strong controlled pull-ups",
            "Strong straight-bar support or dipping ability",
            "Adequate wrist and shoulder mobility",
            "Ability to perform powerful high pulls with control",
        ],
        [
            ("one_verified_pull_up_rep", "pull-up", "At least one analyzer-confirmed Pull-Up repetition"),
            ("one_verified_high_pull_up_rep", "high-pull-up", "At least one analyzer-confirmed High Pull-Up repetition"),
        ],
    ),
}


def upgrade() -> None:
    connection = op.get_bind()
    for slug, (expected_prerequisites, templates) in CURATED.items():
        row = connection.execute(
            sa.text(
                """
                SELECT movement.id AS movement_id, doc.id AS documentation_id,
                       doc.content AS content
                FROM movements AS movement
                JOIN movement_documentation AS doc ON doc.movement_id = movement.id
                WHERE movement.slug = :slug AND doc.status = 'published'
                  AND doc.created_by IS NULL AND doc.published_by IS NULL
                  AND NOT EXISTS (
                    SELECT 1 FROM movement_documentation AS draft
                    WHERE draft.movement_id = movement.id AND draft.status = 'draft'
                  )
                FOR UPDATE OF movement, doc
                """
            ),
            {"slug": slug},
        ).mappings().first()
        if row is None:
            continue
        content = row["content"]
        if (
            content.get("prerequisites") != expected_prerequisites
            or content.get("readiness_rules")
        ):
            continue

        updated = deepcopy(content)
        updated["readiness_rules"] = []
        for code, source_slug, requirement in templates:
            source = connection.execute(
                sa.text(
                    "SELECT id FROM movements WHERE slug = :slug "
                    "AND prescription_type = 'repetitions'"
                ),
                {"slug": source_slug},
            ).scalar_one_or_none()
            if source is None:
                # Never publish a rule that references an absent or unknown source.
                updated = None
                break
            index = len(updated["prerequisites"])
            updated["prerequisites"].append(requirement)
            updated["readiness_rules"].append(
                {
                    "code": code,
                    "type": "movement_performance",
                    "prerequisite_index": index,
                    "movement_id": str(source),
                    "metric": "reps",
                    "operator": ">=",
                    "value": "1",
                    "max_age_days": 365,
                    "accepted_sources": ["uploaded_analysis"],
                }
            )
        if updated is None:
            continue

        next_version = connection.execute(
            sa.text(
                "SELECT COALESCE(MAX(version), 0) + 1 "
                "FROM movement_documentation WHERE movement_id = :movement_id"
            ),
            {"movement_id": row["movement_id"]},
        ).scalar_one()
        connection.execute(
            sa.text(
                "UPDATE movement_documentation SET status = 'archived', "
                "updated_at = now() WHERE id = :id"
            ),
            {"id": row["documentation_id"]},
        )
        connection.execute(
            sa.text(
                """
                INSERT INTO movement_documentation
                    (movement_id, version, status, content, published_at,
                     created_by, published_by, edit_revision)
                VALUES (:movement_id, :version, 'published', CAST(:content AS jsonb),
                        now(), NULL, NULL, 1)
                """
            ),
            {
                "movement_id": row["movement_id"],
                "version": next_version,
                "content": json.dumps(updated),
            },
        )


def downgrade() -> None:
    # Keep immutable safety-documentation history. If a guide has been edited
    # after this migration, a downgrade must not republish an older guide.
    connection = op.get_bind()
    for slug, (expected_prerequisites, templates) in CURATED.items():
        row = connection.execute(
            sa.text(
                """
                SELECT doc.id, doc.version, doc.content, movement.id AS movement_id
                FROM movements AS movement
                JOIN movement_documentation AS doc ON doc.movement_id = movement.id
                WHERE movement.slug = :slug AND doc.status = 'published'
                  AND doc.created_by IS NULL AND doc.published_by IS NULL
                FOR UPDATE OF movement, doc
                """
            ),
            {"slug": slug},
        ).mappings().first()
        if row is None:
            continue
        content = row["content"]
        if (
            content.get("prerequisites")
            != expected_prerequisites + [item[2] for item in templates]
            or [rule.get("code") for rule in content.get("readiness_rules") or []]
            != [item[0] for item in templates]
        ):
            continue
        previous = connection.execute(
            sa.text(
                """
                SELECT id FROM movement_documentation
                WHERE movement_id = :movement_id AND status = 'archived'
                  AND version < :version
                ORDER BY version DESC LIMIT 1
                """
            ),
            {"movement_id": row["movement_id"], "version": row["version"]},
        ).scalar_one_or_none()
        if previous is None:
            continue
        connection.execute(
            sa.text(
                "UPDATE movement_documentation SET status = 'archived', "
                "updated_at = now() WHERE id = :id"
            ),
            {"id": row["id"]},
        )
        connection.execute(
            sa.text(
                "UPDATE movement_documentation SET status = 'published', "
                "updated_at = now() WHERE id = :id"
            ),
            {"id": previous},
        )
