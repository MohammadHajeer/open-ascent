"""Persist ordered product progress for guest analysis streams.

Revision ID: f849f5a08b32
Revises: d7a05e01c9b4
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "f849f5a08b32"
down_revision = "d7a05e01c9b4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "analysis_events",
        sa.Column("id", sa.BigInteger(), sa.Identity(), primary_key=True),
        sa.Column("analysis_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("attempt", sa.Integer(), nullable=False),
        sa.Column("event_key", sa.Text(), nullable=False),
        sa.Column("event_type", sa.Text(), nullable=False),
        sa.Column("payload", postgresql.JSONB(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["analysis_id"], ["analyses.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("analysis_id", "event_key", name="uq_analysis_events_key"),
    )
    op.create_index("ix_analysis_events_analysis_id_id", "analysis_events", ["analysis_id", "id"])


def downgrade() -> None:
    op.drop_index("ix_analysis_events_analysis_id_id", table_name="analysis_events")
    op.drop_table("analysis_events")
