"""Preserve analyses linked as workout evidence.

Revision ID: d2e3f4a5b6c7
Revises: d1e2f3a4b5c6
"""

from alembic import op

revision = "d2e3f4a5b6c7"
down_revision = "d1e2f3a4b5c6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_constraint(
        "workout_sets_analysis_id_fkey", "workout_sets", type_="foreignkey"
    )
    op.create_foreign_key(
        "workout_sets_analysis_id_fkey",
        "workout_sets",
        "analyses",
        ["analysis_id"],
        ["id"],
        ondelete="RESTRICT",
    )


def downgrade() -> None:
    op.drop_constraint(
        "workout_sets_analysis_id_fkey", "workout_sets", type_="foreignkey"
    )
    op.create_foreign_key(
        "workout_sets_analysis_id_fkey",
        "workout_sets",
        "analyses",
        ["analysis_id"],
        ["id"],
        ondelete="SET NULL",
    )
