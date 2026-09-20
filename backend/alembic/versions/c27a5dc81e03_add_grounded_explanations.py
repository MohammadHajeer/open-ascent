"""Add independent AI explanation state and claim lease.

Revision ID: c27a5dc81e03
Revises: f849f5a08b32
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "c27a5dc81e03"
down_revision = "f849f5a08b32"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "analyses", sa.Column("ai_explanation", postgresql.JSONB(), nullable=True)
    )
    op.add_column(
        "analyses",
        sa.Column(
            "ai_feedback_attempts", sa.Integer(), server_default="0", nullable=False
        ),
    )
    op.add_column(
        "analyses", sa.Column("ai_feedback_claim_token", sa.Text(), nullable=True)
    )
    op.add_column(
        "analyses",
        sa.Column(
            "ai_feedback_lease_expires_at", sa.DateTime(timezone=True), nullable=True
        ),
    )
    op.create_check_constraint(
        "ck_analyses_ai_feedback_attempts", "analyses", "ai_feedback_attempts >= 0"
    )
    op.create_check_constraint(
        "ck_analyses_ai_feedback_running_claim",
        "analyses",
        "ai_feedback_status <> 'running' OR "
        "(ai_feedback_claim_token IS NOT NULL AND ai_feedback_lease_expires_at IS NOT NULL)",
    )
    # Historical deterministic results did not have explanation jobs.
    op.execute(
        "UPDATE analyses SET ai_feedback_status = 'skipped' "
        "WHERE status = 'completed' AND ai_feedback_status = 'pending'"
    )


def downgrade() -> None:
    op.drop_constraint(
        "ck_analyses_ai_feedback_running_claim", "analyses", type_="check"
    )
    op.drop_constraint("ck_analyses_ai_feedback_attempts", "analyses", type_="check")
    op.drop_column("analyses", "ai_feedback_lease_expires_at")
    op.drop_column("analyses", "ai_feedback_claim_token")
    op.drop_column("analyses", "ai_feedback_attempts")
    op.drop_column("analyses", "ai_explanation")
