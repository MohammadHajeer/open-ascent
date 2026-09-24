"""Mark the five Vertical Pull variants as Live Coach supported.

Revision ID: f2a3b4c5d6e7
Revises: e1f2a3b4c5d6
"""

from alembic import op

revision = "f2a3b4c5d6e7"
down_revision = "e1f2a3b4c5d6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "UPDATE movements SET live_coach_supported = true "
        "WHERE family_key = 'vertical_pull' AND slug IN "
        "('pull-up', 'chin-up', 'close-grip-pull-up', "
        "'wide-grip-pull-up', 'high-pull-up')"
    )


def downgrade() -> None:
    # Availability may have been edited by an administrator since upgrade.
    pass
