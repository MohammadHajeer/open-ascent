"""Enable the browser Live Coach proof for pull-ups.

Revision ID: c0a1b2c3d4e5
Revises: e5f6a7b8c9d0
"""

from alembic import op

revision = "c0a1b2c3d4e5"
down_revision = "e5f6a7b8c9d0"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "UPDATE movements SET live_coach_supported = true "
        "WHERE slug = 'pull-up' AND family_key = 'vertical_pull'"
    )


def downgrade() -> None:
    # Movement availability may have since been managed by an admin.
    pass

