"""add application role to Supabase access tokens

Revision ID: 71c4ea9b20d5
Revises: e42f8b19c6a0
"""

from alembic import op

revision = "71c4ea9b20d5"
down_revision = "e42f8b19c6a0"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # The existing hook runs as supabase_auth_admin under profiles RLS.
    op.execute(
        "GRANT SELECT (app_role) ON TABLE public.profiles TO supabase_auth_admin"
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
            -- A future plan claim can be added here.
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
            RETURN jsonb_set(event, '{claims}', claims);
        END;
        $$
        """
    )
    op.execute(
        "REVOKE SELECT (app_role) ON TABLE public.profiles FROM supabase_auth_admin"
    )
