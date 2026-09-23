"""Track an athlete's first dashboard tour decision.

Revision ID: e1f2a3b4c5d6
Revises: d9a1b2c3d4e5
"""

import sqlalchemy as sa
from alembic import op

revision = "e1f2a3b4c5d6"
down_revision = "d9a1b2c3d4e5"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "profiles",
        sa.Column(
            "dashboard_tour_status",
            sa.Text(),
            nullable=False,
            server_default=sa.text("'not_started'"),
        ),
    )
    op.create_check_constraint(
        "ck_profiles_dashboard_tour_status",
        "profiles",
        "dashboard_tour_status IN ('not_started', 'completed', 'dismissed')",
    )


def downgrade() -> None:
    op.drop_constraint("ck_profiles_dashboard_tour_status", "profiles", type_="check")
    op.drop_column("profiles", "dashboard_tour_status")
