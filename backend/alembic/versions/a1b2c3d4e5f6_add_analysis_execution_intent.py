"""add analysis execution intent

Revision ID: a1b2c3d4e5f6
Revises: 9b7c6d5e4f3a
"""

from alembic import op
import sqlalchemy as sa

revision = "a1b2c3d4e5f6"
down_revision = "9b7c6d5e4f3a"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "analyses",
        sa.Column(
            "execution_intent",
            sa.Text(),
            server_default=sa.text("'normal_training'"),
            nullable=False,
        ),
    )
    op.create_check_constraint(
        "ck_analyses_execution_intent",
        "analyses",
        "execution_intent IN ('normal_training', 'explosive_power', "
        "'controlled_tempo', 'max_test', 'technique_check')",
    )


def downgrade() -> None:
    op.drop_constraint("ck_analyses_execution_intent", "analyses", type_="check")
    op.drop_column("analyses", "execution_intent")
