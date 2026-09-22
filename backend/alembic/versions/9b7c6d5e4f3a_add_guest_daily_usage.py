"""Add durable race-safe guest daily usage admissions.

Revision ID: 9b7c6d5e4f3a
Revises: d2e3f4a5b6c7
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "9b7c6d5e4f3a"
down_revision = "d2e3f4a5b6c7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "guest_analysis_usage",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column("analysis_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("usage_date", sa.Date(), nullable=False),
        sa.Column("guest_identity_key", sa.Text(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["analysis_id"], ["analyses.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("analysis_id", name="uq_guest_analysis_usage_analysis"),
        sa.UniqueConstraint(
            "usage_date",
            "guest_identity_key",
            name="uq_guest_analysis_usage_identity_day",
        ),
    )
    op.create_index(
        "ix_guest_analysis_usage_date",
        "guest_analysis_usage",
        ["usage_date"],
    )


def downgrade() -> None:
    op.drop_index("ix_guest_analysis_usage_date", table_name="guest_analysis_usage")
    op.drop_table("guest_analysis_usage")
