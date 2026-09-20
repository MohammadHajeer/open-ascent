"""add onboarding claim to Supabase access tokens

Revision ID: e42f8b19c6a0
Revises: a08e9f4c12b3
"""

from alembic import op

revision = "e42f8b19c6a0"
down_revision = "a08e9f4c12b3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # The hook runs as supabase_auth_admin, under the profiles table's RLS.
    op.execute("GRANT USAGE ON SCHEMA public TO supabase_auth_admin")
    op.execute(
        "GRANT SELECT (id, onboarding_completed_at) "
        "ON TABLE public.profiles TO supabase_auth_admin"
    )
    op.execute(
        "CREATE POLICY auth_hook_reads_onboarding_state "
        "ON public.profiles FOR SELECT TO supabase_auth_admin USING (true)"
    )

    op.execute(
        """
        CREATE FUNCTION public.open_ascent_access_token_hook(event jsonb)
        RETURNS jsonb
        LANGUAGE plpgsql
        STABLE
        SECURITY INVOKER
        SET search_path = ''
        AS $$
        DECLARE
            claims jsonb;
            onboarding_complete boolean;
        BEGIN
            SELECT EXISTS (
                SELECT 1
                FROM public.profiles AS profile
                WHERE profile.id = (event->>'user_id')::uuid
                  AND profile.onboarding_completed_at IS NOT NULL
            ) INTO onboarding_complete;

            claims := event->'claims';
            claims := jsonb_set(
                claims,
                '{onboarding_complete}',
                to_jsonb(onboarding_complete),
                true
            );
            -- Future user_role and plan claims can be added here.
            RETURN jsonb_set(event, '{claims}', claims);
        END;
        $$
        """
    )
    op.execute(
        "REVOKE EXECUTE ON FUNCTION public.open_ascent_access_token_hook(jsonb) "
        "FROM PUBLIC, anon, authenticated"
    )
    op.execute(
        "GRANT EXECUTE ON FUNCTION public.open_ascent_access_token_hook(jsonb) "
        "TO supabase_auth_admin"
    )


def downgrade() -> None:
    # Schema usage may predate this hook, so leave that shared grant intact.
    op.execute("DROP FUNCTION public.open_ascent_access_token_hook(jsonb)")
    op.execute(
        "DROP POLICY auth_hook_reads_onboarding_state ON public.profiles"
    )
    op.execute(
        "REVOKE SELECT (id, onboarding_completed_at) "
        "ON TABLE public.profiles FROM supabase_auth_admin"
    )
