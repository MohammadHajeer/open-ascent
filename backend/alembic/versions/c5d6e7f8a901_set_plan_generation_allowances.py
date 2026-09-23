"""Configure monthly training-plan generation allowances.

Revision ID: c5d6e7f8a901
Revises: c4a14baf8021
"""

import sqlalchemy as sa
from alembic import op

revision = "c5d6e7f8a901"
down_revision = "c4a14baf8021"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        sa.text(
            """
            UPDATE plan_entitlements AS entitlement
            SET entitlement_type = 'metered',
                enabled = true,
                allowance_units = CASE plan.code WHEN 'free' THEN 1 WHEN 'pro' THEN 10 END,
                reset_policy = 'calendar_month_utc',
                revision = revision + 1,
                effective_from = now(),
                updated_at = now()
            FROM subscription_plans AS plan
            WHERE entitlement.plan_id = plan.id
              AND entitlement.feature_key = 'training_plan_generation'
              AND plan.code IN ('free', 'pro')
            """
        )
    )


def downgrade() -> None:
    op.execute(
        sa.text(
            """
            UPDATE plan_entitlements AS entitlement
            SET allowance_units = NULL,
                revision = revision + 1,
                effective_from = now(),
                updated_at = now()
            FROM subscription_plans AS plan
            WHERE entitlement.plan_id = plan.id
              AND entitlement.feature_key = 'training_plan_generation'
              AND plan.code IN ('free', 'pro')
            """
        )
    )
