"""Persistent AI Coach and generation ledger.

Revision ID: c4a14baf8021
Revises: b2c3d4e5f6a7
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "c4a14baf8021"
down_revision = "b2c3d4e5f6a7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "conversations", sa.Column("openai_conversation_id", sa.Text(), nullable=True)
    )
    op.create_unique_constraint(
        "uq_conversations_openai_conversation_id",
        "conversations",
        ["openai_conversation_id"],
    )
    op.create_table(
        "coach_generations",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "conversation_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("conversations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "user_message_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("messages.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "assistant_message_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("messages.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("client_request_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column(
            "feature_usage_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("feature_usage.id", ondelete="SET NULL"),
            nullable=True,
            unique=True,
        ),
        sa.Column("provider_response_id", sa.Text(), nullable=True, unique=True),
        sa.Column("status", sa.Text(), nullable=False, server_default="reserved"),
        sa.Column("error_code", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.UniqueConstraint(
            "conversation_id", "client_request_id", name="uq_coach_generation_request"
        ),
        sa.UniqueConstraint("user_message_id", name="uq_coach_generation_user_message"),
        sa.UniqueConstraint(
            "assistant_message_id", name="uq_coach_generation_assistant_message"
        ),
        sa.CheckConstraint(
            "status IN ('reserved', 'requesting', 'streaming', 'completed', 'failed', 'interrupted')",
            name="ck_coach_generations_status",
        ),
    )
    # No numeric product allowance was selected in SUB-04. Coach is a paid
    # Pro capability; its existing feature key and ledger remain authoritative.
    op.execute(
        "UPDATE plan_entitlements SET entitlement_type = 'boolean', enabled = false, allowance_units = NULL, reset_policy = NULL, revision = revision + 1, effective_from = now(), updated_at = now() WHERE feature_key = 'ai_coach_reply' AND plan_id IN (SELECT id FROM subscription_plans WHERE code = 'free')"
    )
    op.execute(
        "UPDATE plan_entitlements SET entitlement_type = 'unlimited', enabled = true, allowance_units = NULL, reset_policy = NULL, revision = revision + 1, effective_from = now(), updated_at = now() WHERE feature_key = 'ai_coach_reply' AND plan_id IN (SELECT id FROM subscription_plans WHERE code = 'pro')"
    )


def downgrade() -> None:
    op.execute(
        "UPDATE plan_entitlements SET entitlement_type = 'metered', enabled = true, allowance_units = NULL, reset_policy = 'calendar_month_utc', revision = revision + 1, effective_from = now(), updated_at = now() WHERE feature_key = 'ai_coach_reply'"
    )
    op.drop_table("coach_generations")
    op.drop_constraint(
        "uq_conversations_openai_conversation_id", "conversations", type_="unique"
    )
    op.drop_column("conversations", "openai_conversation_id")
