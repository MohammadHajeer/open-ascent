"""Give Free athletes a daily AI Coach message allowance.

Revision ID: d8e9f0a1b2c3
Revises: b71e2c934af0
"""

import sqlalchemy as sa
from alembic import op

revision = "d8e9f0a1b2c3"
down_revision = "b71e2c934af0"
branch_labels = None
depends_on = None

# Mirrors FREE_AI_COACH_DAILY_MESSAGES in app.subscriptions.catalog at the time
# of this migration; migrations stay stable if the catalog changes later.
FREE_DAILY_COACH_MESSAGES = 5

CONFIGURATION = """
    (entitlement_type = 'boolean'
        AND allowance_units IS NULL
        AND reset_policy IS NULL)
    OR
    (entitlement_type = 'metered'
        AND enabled
        AND (allowance_units IS NULL OR allowance_units >= 0)
        AND reset_policy IN ({policies}))
    OR
    (entitlement_type = 'unlimited'
        AND enabled
        AND allowance_units IS NULL
        AND reset_policy IS NULL)
"""


def _replace_configuration(policies: str) -> None:
    op.drop_constraint(
        "ck_plan_entitlements_configuration", "plan_entitlements", type_="check"
    )
    op.create_check_constraint(
        "ck_plan_entitlements_configuration",
        "plan_entitlements",
        CONFIGURATION.format(policies=policies),
    )


def upgrade() -> None:
    _replace_configuration("'calendar_month_utc', 'calendar_day_utc'")
    op.execute(
        sa.text(
            """
            UPDATE plan_entitlements AS entitlement
            SET entitlement_type = 'metered',
                enabled = true,
                allowance_units = :allowance,
                reset_policy = 'calendar_day_utc',
                revision = revision + 1,
                effective_from = now(),
                updated_at = now()
            FROM subscription_plans AS plan
            WHERE entitlement.plan_id = plan.id
              AND entitlement.feature_key = 'ai_coach_reply'
              AND plan.code = 'free'
            """
        ).bindparams(allowance=FREE_DAILY_COACH_MESSAGES)
    )


def downgrade() -> None:
    # Daily ledger rows remain as history; they no longer admit anything once
    # the Free entitlement is disabled again.
    op.execute(
        sa.text(
            """
            UPDATE plan_entitlements AS entitlement
            SET entitlement_type = 'boolean',
                enabled = false,
                allowance_units = NULL,
                reset_policy = NULL,
                revision = revision + 1,
                effective_from = now(),
                updated_at = now()
            FROM subscription_plans AS plan
            WHERE entitlement.plan_id = plan.id
              AND entitlement.feature_key = 'ai_coach_reply'
              AND plan.code = 'free'
            """
        )
    )
    remaining = op.get_bind().execute(
        sa.text(
            "SELECT COUNT(*) FROM plan_entitlements "
            "WHERE reset_policy = 'calendar_day_utc'"
        )
    ).scalar_one()
    if remaining:
        raise RuntimeError(
            "An entitlement still uses a daily reset; revise it before downgrading."
        )
    _replace_configuration("'calendar_month_utc'")
