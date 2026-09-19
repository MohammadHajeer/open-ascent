"""enable upload analysis for pull-up and chin-up

Revision ID: d7a05e01c9b4
Revises: b6b9e9b1b47d
"""

from alembic import op

revision = "d7a05e01c9b4"
down_revision = "b6b9e9b1b47d"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "UPDATE movements SET upload_analysis_supported = true "
        "WHERE slug IN ('pull-up', 'chin-up')"
    )


def downgrade() -> None:
    # Keep movement availability as managed data once enabled.
    pass
