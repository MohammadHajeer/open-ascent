"""add Stripe webhook reconciliation state

Revision ID: d4e5f6a7b8c9
Revises: c3a4b5d6e7f8
"""

import sqlalchemy as sa
from alembic import op

revision = "d4e5f6a7b8c9"
down_revision = "c3a4b5d6e7f8"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "user_subscriptions",
        sa.Column("provider_event_created_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_table(
        "stripe_webhook_events",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("event_type", sa.Text(), nullable=False),
        sa.Column("stripe_object_id", sa.Text(), nullable=True),
        sa.Column("event_created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("processed_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "outcome",
            sa.Text(),
            server_default=sa.text("'processing'"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "outcome IN ('processing','applied','duplicate','ignored_unhandled',"
            "'ignored_unmapped','ignored_stale','ignored_invalid')",
            name="ck_stripe_webhook_events_outcome",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.execute("ALTER TABLE public.stripe_webhook_events ENABLE ROW LEVEL SECURITY")
    op.execute(
        "REVOKE ALL PRIVILEGES ON TABLE public.stripe_webhook_events "
        "FROM anon, authenticated"
    )


def downgrade() -> None:
    op.drop_table("stripe_webhook_events")
    op.drop_column("user_subscriptions", "provider_event_created_at")
