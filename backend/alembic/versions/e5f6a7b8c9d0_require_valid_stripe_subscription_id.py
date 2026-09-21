"""require a Stripe subscription ID for effective Pro access

Revision ID: e5f6a7b8c9d0
Revises: d4e5f6a7b8c9
"""

from alembic import op

revision = "e5f6a7b8c9d0"
down_revision = "d4e5f6a7b8c9"
branch_labels = None
depends_on = None


def _replace_resolver(*, require_stripe_id: bool) -> None:
    provider_id_clause = (
        "AND left(subscription.stripe_subscription_id, 4) = 'sub_'"
        if require_stripe_id
        else "AND subscription.stripe_subscription_id IS NOT NULL"
    )
    op.execute(
        f"""
        CREATE OR REPLACE FUNCTION public.resolve_effective_plan(
            target_user_id uuid,
            evaluated_at timestamptz DEFAULT now()
        )
        RETURNS text
        LANGUAGE sql
        STABLE
        SECURITY DEFINER
        SET search_path = ''
        AS $$
            SELECT CASE WHEN EXISTS (
                SELECT 1
                FROM public.user_subscriptions AS subscription
                JOIN public.subscription_plans AS plan
                  ON plan.id = subscription.plan_id
                WHERE subscription.user_id = target_user_id
                  AND plan.code = 'pro'
                  AND plan.is_active
                  AND plan.stripe_price_id IS NOT NULL
                  AND subscription.provider_status = 'active'
                  {provider_id_clause}
                  AND subscription.last_verified_at IS NOT NULL
                  AND subscription.last_verified_at <= evaluated_at
                  AND subscription.effective_start IS NOT NULL
                  AND subscription.effective_end IS NOT NULL
                  AND subscription.effective_start <= evaluated_at
                  AND evaluated_at < subscription.effective_end
                  AND subscription.current_period_start IS NOT NULL
                  AND subscription.current_period_end IS NOT NULL
                  AND subscription.current_period_start <= evaluated_at
                  AND evaluated_at < subscription.current_period_end
            ) THEN 'pro' ELSE 'free' END
        $$
        """
    )


def upgrade() -> None:
    _replace_resolver(require_stripe_id=True)


def downgrade() -> None:
    _replace_resolver(require_stripe_id=False)
