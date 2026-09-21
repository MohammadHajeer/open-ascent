"""Support authenticated analysis ownership, history, and media cleanup.

Revision ID: a624c801e35d
Revises: 8fc3c1052e6b
"""

from alembic import op

revision = "a624c801e35d"
down_revision = "8fc3c1052e6b"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_constraint("ck_analyses_target_or_family", "analyses", type_="check")
    op.create_check_constraint(
        "ck_analyses_target_or_family",
        "analyses",
        "movement_id IS NOT NULL OR family_key = 'vertical_pull'",
    )
    op.create_index("ix_analyses_user_history", "analyses", ["user_id", "created_at"])
    op.create_index(
        "ix_analyses_authenticated_media_cleanup",
        "analyses",
        ["owner_kind", "video_delete_after"],
    )


def downgrade() -> None:
    op.drop_index("ix_analyses_authenticated_media_cleanup", table_name="analyses")
    op.drop_index("ix_analyses_user_history", table_name="analyses")
    op.drop_constraint("ck_analyses_target_or_family", "analyses", type_="check")
    op.create_check_constraint(
        "ck_analyses_target_or_family",
        "analyses",
        "movement_id IS NOT NULL OR "
        "(owner_kind = 'guest' AND family_key = 'vertical_pull')",
    )
