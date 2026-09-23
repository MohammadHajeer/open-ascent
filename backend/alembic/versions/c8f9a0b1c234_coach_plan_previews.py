"""Add durable, owner-scoped Coach plan previews.

Revision ID: c8f9a0b1c234
Revises: c7e8f9a0b123
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "c8f9a0b1c234"
down_revision = "c7e8f9a0b123"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "coach_generations",
        sa.Column("kind", sa.Text(), nullable=False, server_default="chat"),
    )
    op.create_check_constraint(
        "ck_coach_generations_kind", "coach_generations", "kind IN ('chat', 'plan')"
    )
    op.create_table(
        "training_plan_previews",
        sa.Column(
            "id", postgresql.UUID(as_uuid=True), primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "user_id", postgresql.UUID(as_uuid=True),
            sa.ForeignKey("profiles.id", ondelete="CASCADE"), nullable=False,
        ),
        sa.Column(
            "coach_generation_id", postgresql.UUID(as_uuid=True),
            sa.ForeignKey("coach_generations.id", ondelete="CASCADE"), nullable=False,
        ),
        sa.Column("plan_document", postgresql.JSONB(), nullable=False),
        sa.Column(
            "saved_plan_id", postgresql.UUID(as_uuid=True),
            sa.ForeignKey("training_plans.id", ondelete="CASCADE"), nullable=True,
        ),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False,
            server_default=sa.func.now(),
        ),
        sa.UniqueConstraint("coach_generation_id", name="uq_plan_previews_generation"),
        sa.UniqueConstraint("saved_plan_id", name="uq_plan_previews_saved_plan"),
    )
    op.create_index(
        "ix_training_plan_previews_user_id", "training_plan_previews", ["user_id"]
    )


def downgrade() -> None:
    op.drop_index("ix_training_plan_previews_user_id", table_name="training_plan_previews")
    op.drop_table("training_plan_previews")
    op.drop_constraint("ck_coach_generations_kind", "coach_generations", type_="check")
    op.drop_column("coach_generations", "kind")
