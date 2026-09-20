"""Enable existing vertical-pull descendants for guest analysis.

Revision ID: 8fc3c1052e6b
Revises: da520aeed891
"""

from alembic import op

revision = "8fc3c1052e6b"
down_revision = "da520aeed891"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("UPDATE movements SET upload_analysis_supported = true WHERE slug IN "
               "('close-grip-pull-up', 'wide-grip-pull-up', 'high-pull-up') "
               "AND family_key = 'vertical_pull'")


def downgrade() -> None:
    # Movement availability may have since been managed by an admin.
    pass
