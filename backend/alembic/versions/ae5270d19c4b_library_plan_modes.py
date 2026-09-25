"""Store optional Library generation metadata.

Revision ID: ae5270d19c4b
Revises: f2a3b4c5d6e7
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "ae5270d19c4b"
down_revision = "f2a3b4c5d6e7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("coach_generations", sa.Column("plan_context", postgresql.JSONB(), nullable=True))


def downgrade() -> None:
    op.drop_column("coach_generations", "plan_context")
