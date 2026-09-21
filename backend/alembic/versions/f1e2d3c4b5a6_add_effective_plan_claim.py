"""derive effective plan in the existing Supabase access-token hook

Revision ID: f1e2d3c4b5a6
Revises: e0b1c2d3e4f5
"""

from alembic import op

revision = "f1e2d3c4b5a6"
down_revision = "e0b1c2d3e4f5"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # The hook runs as supabase_auth_admin. The resolver is SECURITY DEFINER so
    # the hook can read the subscription tables without exposing them to the
    # auth-facing roles or changing application RLS policy.
    op.execute("GRANT USAGE ON SCHEMA public TO supabase_auth_admin")
    op.execute(
        "GRANT SELECT (id, code, is_active, stripe_price_id) "
        "ON TABLE public.subscription_plans TO supabase_auth_admin"
    )
    op.execute(
        "GRANT SELECT (user_id, plan_id, provider_status, effective_start, "
        "effective_end, current_period_start, current_period_end, "
        "stripe_subscription_id, last_verified_at) "
        "ON TABLE public.user_subscriptions TO supabase_auth_admin"
    )
    op.execute(
        """
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
                  AND subscription.stripe_subscription_id IS NOT NULL
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
    op.execute(
        "REVOKE EXECUTE ON FUNCTION public.resolve_effective_plan(uuid, timestamptz) "
        "FROM PUBLIC, anon, authenticated"
    )
    op.execute(
        "GRANT EXECUTE ON FUNCTION public.resolve_effective_plan(uuid, timestamptz) "
        "TO supabase_auth_admin"
    )
    op.execute(
        """
        CREATE OR REPLACE FUNCTION public.open_ascent_access_token_hook(event jsonb)
        RETURNS jsonb
        LANGUAGE plpgsql
        STABLE
        SECURITY INVOKER
        SET search_path = ''
        AS $$
        DECLARE
            claims jsonb;
            onboarding_complete boolean;
            user_role text;
            effective_plan text;
        BEGIN
            SELECT profile.onboarding_completed_at IS NOT NULL,
                   CASE
                       WHEN profile.app_role IN ('athlete', 'admin')
                           THEN profile.app_role
                       ELSE NULL
                   END
            INTO onboarding_complete, user_role
            FROM public.profiles AS profile
            WHERE profile.id = (event->>'user_id')::uuid;

            effective_plan := public.resolve_effective_plan(
                (event->>'user_id')::uuid,
                now()
            );

            claims := event->'claims';
            claims := jsonb_set(
                claims,
                '{onboarding_complete}',
                to_jsonb(COALESCE(onboarding_complete, false)),
                true
            );
            claims := jsonb_set(
                claims,
                '{user_role}',
                COALESCE(to_jsonb(user_role), 'null'::jsonb),
                true
            );
            claims := jsonb_set(
                claims,
                '{effective_plan}',
                to_jsonb(COALESCE(effective_plan, 'free')),
                true
            );
            RETURN jsonb_set(event, '{claims}', claims);
        END;
        $$
        """
    )


def downgrade() -> None:
    op.execute(
        """
        CREATE OR REPLACE FUNCTION public.open_ascent_access_token_hook(event jsonb)
        RETURNS jsonb
        LANGUAGE plpgsql
        STABLE
        SECURITY INVOKER
        SET search_path = ''
        AS $$
        DECLARE
            claims jsonb;
            onboarding_complete boolean;
            user_role text;
        BEGIN
            SELECT profile.onboarding_completed_at IS NOT NULL,
                   CASE
                       WHEN profile.app_role IN ('athlete', 'admin')
                           THEN profile.app_role
                       ELSE NULL
                   END
            INTO onboarding_complete, user_role
            FROM public.profiles AS profile
            WHERE profile.id = (event->>'user_id')::uuid;

            claims := event->'claims';
            claims := jsonb_set(
                claims,
                '{onboarding_complete}',
                to_jsonb(COALESCE(onboarding_complete, false)),
                true
            );
            claims := jsonb_set(
                claims,
                '{user_role}',
                COALESCE(to_jsonb(user_role), 'null'::jsonb),
                true
            );
            RETURN jsonb_set(event, '{claims}', claims);
        END;
        $$
        """
    )
    op.execute(
        "REVOKE EXECUTE ON FUNCTION public.resolve_effective_plan(uuid, timestamptz) "
        "FROM supabase_auth_admin"
    )
    op.execute("DROP FUNCTION public.resolve_effective_plan(uuid, timestamptz)")
    op.execute(
        "REVOKE SELECT (id, code, is_active, stripe_price_id) "
        "ON TABLE public.subscription_plans FROM supabase_auth_admin"
    )
    op.execute(
        "REVOKE SELECT (user_id, plan_id, provider_status, effective_start, "
        "effective_end, current_period_start, current_period_end, "
        "stripe_subscription_id, last_verified_at) "
        "ON TABLE public.user_subscriptions FROM supabase_auth_admin"
    )
