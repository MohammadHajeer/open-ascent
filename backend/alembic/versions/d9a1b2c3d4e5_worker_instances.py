"""Persist worker heartbeats independent of job leases."""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "d9a1b2c3d4e5"
down_revision = "c8f9a0b1c234"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "worker_instances",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("worker_type", sa.Text(), nullable=False),
        sa.Column("state", sa.Text(), nullable=False),
        sa.Column("current_job_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column(
            "started_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "last_seen_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.CheckConstraint(
            "worker_type IN ('analysis', 'explanation', 'guest_cleanup')",
            name="ck_worker_instances_type",
        ),
        sa.CheckConstraint(
            "state IN ('idle', 'busy', 'failed', 'stopped')",
            name="ck_worker_instances_state",
        ),
    )
    op.create_index(
        "ix_worker_instances_last_seen", "worker_instances", ["last_seen_at"]
    )
    op.execute("ALTER TABLE public.worker_instances ENABLE ROW LEVEL SECURITY")
    op.execute(
        "REVOKE ALL PRIVILEGES ON TABLE public.worker_instances FROM anon, authenticated"
    )


def downgrade() -> None:
    op.drop_index("ix_worker_instances_last_seen", table_name="worker_instances")
    op.drop_table("worker_instances")
