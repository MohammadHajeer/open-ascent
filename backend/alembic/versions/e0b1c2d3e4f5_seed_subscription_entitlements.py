"""Seed subscription plans and establish entitlement policy.

Revision ID: e0b1c2d3e4f5
Revises: a624c801e35d
"""

from alembic import op
import sqlalchemy as sa

revision = "e0b1c2d3e4f5"
down_revision = "a624c801e35d"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_constraint(
        "ck_subscription_plans_price_mapping",
        "subscription_plans",
        type_="check",
    )
    op.create_check_constraint(
        "ck_subscription_plans_price_mapping",
        "subscription_plans",
        "stripe_price_id IS NULL OR code = 'pro'",
    )

    op.add_column(
        "plan_entitlements",
        sa.Column(
            "entitlement_type",
            sa.Text(),
            nullable=True,
            server_default=sa.text("'metered'"),
        ),
    )
    op.alter_column("plan_entitlements", "entitlement_type", nullable=False)
    op.alter_column("plan_entitlements", "allowance_units", nullable=True)
    op.alter_column(
        "plan_entitlements",
        "reset_policy",
        nullable=True,
        server_default=None,
    )

    op.drop_constraint(
        "ck_plan_entitlements_feature_key",
        "plan_entitlements",
        type_="check",
    )
    op.drop_constraint(
        "ck_plan_entitlements_allowance_units",
        "plan_entitlements",
        type_="check",
    )
    op.drop_constraint(
        "ck_plan_entitlements_reset_policy",
        "plan_entitlements",
        type_="check",
    )
    op.execute("UPDATE plan_entitlements SET enabled = true")
    op.create_check_constraint(
        "ck_plan_entitlements_feature_key",
        "plan_entitlements",
        "feature_key IN ("
        "'video_analysis', 'training_plan_generation', 'ai_coach_reply', "
        "'live_coach', 'adaptive_training_plans', "
        "'advanced_progress_insights'"
        ")",
    )
    op.create_check_constraint(
        "ck_plan_entitlements_type",
        "plan_entitlements",
        "entitlement_type IN ('boolean', 'metered', 'unlimited')",
    )
    op.create_check_constraint(
        "ck_plan_entitlements_configuration",
        "plan_entitlements",
        """
        (entitlement_type = 'boolean'
            AND allowance_units IS NULL
            AND reset_policy IS NULL)
        OR
        (entitlement_type = 'metered'
            AND enabled
            AND (allowance_units IS NULL OR allowance_units >= 0)
            AND reset_policy = 'calendar_month_utc')
        OR
        (entitlement_type = 'unlimited'
            AND enabled
            AND allowance_units IS NULL
            AND reset_policy IS NULL)
        """,
    )

    # FND-04 allowed entitlement history by effective date, but supplied no
    # active-row boundary. Consolidate to one centrally managed row per feature.
    op.execute(
        """
        WITH ranked AS (
            SELECT
                id,
                first_value(id) OVER (
                    PARTITION BY plan_id, feature_key
                    ORDER BY effective_from DESC, revision DESC, created_at DESC
                ) AS keep_id,
                row_number() OVER (
                    PARTITION BY plan_id, feature_key
                    ORDER BY effective_from DESC, revision DESC, created_at DESC
                ) AS row_number
            FROM plan_entitlements
        )
        UPDATE feature_usage AS usage
        SET entitlement_id = ranked.keep_id
        FROM ranked
        WHERE usage.entitlement_id = ranked.id
          AND ranked.row_number > 1
        """
    )
    op.execute(
        """
        WITH ranked AS (
            SELECT
                id,
                row_number() OVER (
                    PARTITION BY plan_id, feature_key
                    ORDER BY effective_from DESC, revision DESC, created_at DESC
                ) AS row_number
            FROM plan_entitlements
        )
        DELETE FROM plan_entitlements AS entitlement
        USING ranked
        WHERE entitlement.id = ranked.id
          AND ranked.row_number > 1
        """
    )
    op.drop_constraint(
        "uq_plan_entitlements_plan_feature_effective",
        "plan_entitlements",
        type_="unique",
    )
    op.create_unique_constraint(
        "uq_plan_entitlements_plan_feature",
        "plan_entitlements",
        ["plan_id", "feature_key"],
    )

    # Plan IDs remain database generated. Codes are the stable seed identities.
    op.execute(
        """
        INSERT INTO subscription_plans (code, name, is_active)
        VALUES ('free', 'Free', true), ('pro', 'Pro', true)
        ON CONFLICT (code) DO UPDATE
        SET name = EXCLUDED.name,
            is_active = true,
            updated_at = now()
        """
    )

    # Null metered allowances mean "limit pending product configuration". They
    # are not unlimited; unlimited is a separate entitlement type.
    op.execute(
        """
        INSERT INTO plan_entitlements (
            plan_id,
            feature_key,
            entitlement_type,
            enabled,
            allowance_units,
            reset_policy,
            revision,
            effective_from
        )
        SELECT
            plan.id,
            configured.feature_key,
            configured.entitlement_type,
            COALESCE(configured.enabled, plan.code = 'pro'),
            NULL,
            configured.reset_policy,
            1,
            TIMESTAMPTZ '2026-09-21 00:00:00+00'
        FROM subscription_plans AS plan
        CROSS JOIN (
            VALUES
                ('video_analysis', 'metered', true, 'calendar_month_utc'),
                ('ai_coach_reply', 'metered', true, 'calendar_month_utc'),
                ('training_plan_generation', 'metered', true, 'calendar_month_utc'),
                ('live_coach', 'boolean', NULL, NULL),
                ('adaptive_training_plans', 'boolean', NULL, NULL),
                ('advanced_progress_insights', 'boolean', NULL, NULL)
        ) AS configured(feature_key, entitlement_type, enabled, reset_policy)
        WHERE plan.code IN ('free', 'pro')
        ON CONFLICT (plan_id, feature_key) DO NOTHING
        """
    )
    op.execute(
        """
        UPDATE plan_entitlements AS entitlement
        SET enabled = CASE
                WHEN entitlement.feature_key IN (
                    'live_coach',
                    'adaptive_training_plans',
                    'advanced_progress_insights'
                ) THEN plan.code = 'pro'
                ELSE true
            END,
            entitlement_type = CASE
                WHEN entitlement.feature_key IN (
                    'live_coach',
                    'adaptive_training_plans',
                    'advanced_progress_insights'
                ) THEN 'boolean'
                ELSE 'metered'
            END,
            allowance_units = CASE
                WHEN entitlement.feature_key IN (
                    'video_analysis',
                    'ai_coach_reply',
                    'training_plan_generation'
                ) THEN entitlement.allowance_units
                ELSE NULL
            END,
            reset_policy = CASE
                WHEN entitlement.feature_key IN (
                    'video_analysis',
                    'ai_coach_reply',
                    'training_plan_generation'
                ) THEN 'calendar_month_utc'
                ELSE NULL
            END,
            updated_at = now()
        FROM subscription_plans AS plan
        WHERE entitlement.plan_id = plan.id
          AND plan.code IN ('free', 'pro')
          AND entitlement.feature_key IN (
              'video_analysis',
              'ai_coach_reply',
              'training_plan_generation',
              'live_coach',
              'adaptive_training_plans',
              'advanced_progress_insights'
          )
        """
    )

    op.execute(
        """
        CREATE FUNCTION public.assign_free_subscription()
        RETURNS trigger
        LANGUAGE plpgsql
        SECURITY DEFINER
        SET search_path = ''
        AS $$
        BEGIN
            INSERT INTO public.user_subscriptions (user_id, plan_id)
            SELECT NEW.id, plan.id
            FROM public.subscription_plans AS plan
            WHERE plan.code = 'free'
            ON CONFLICT (user_id) DO NOTHING;
            RETURN NEW;
        END;
        $$
        """
    )
    op.execute(
        """
        CREATE TRIGGER assign_free_subscription_after_profile_insert
        AFTER INSERT ON public.profiles
        FOR EACH ROW EXECUTE FUNCTION public.assign_free_subscription()
        """
    )
    op.execute(
        """
        INSERT INTO user_subscriptions (user_id, plan_id)
        SELECT profile.id, plan.id
        FROM profiles AS profile
        CROSS JOIN subscription_plans AS plan
        WHERE plan.code = 'free'
        ON CONFLICT (user_id) DO NOTHING
        """
    )


def downgrade() -> None:
    op.execute(
        "DROP TRIGGER IF EXISTS assign_free_subscription_after_profile_insert "
        "ON public.profiles"
    )
    op.execute("DROP FUNCTION IF EXISTS public.assign_free_subscription()")

    op.execute(
        """
        DELETE FROM plan_entitlements
        WHERE feature_key IN (
            'live_coach',
            'adaptive_training_plans',
            'advanced_progress_insights'
        )
        """
    )
    op.execute(
        """
        UPDATE plan_entitlements
        SET allowance_units = COALESCE(allowance_units, 0),
            reset_policy = 'calendar_month_utc'
        """
    )
    op.drop_constraint(
        "uq_plan_entitlements_plan_feature",
        "plan_entitlements",
        type_="unique",
    )
    op.create_unique_constraint(
        "uq_plan_entitlements_plan_feature_effective",
        "plan_entitlements",
        ["plan_id", "feature_key", "effective_from"],
    )
    op.drop_constraint(
        "ck_plan_entitlements_configuration",
        "plan_entitlements",
        type_="check",
    )
    op.drop_constraint(
        "ck_plan_entitlements_type",
        "plan_entitlements",
        type_="check",
    )
    op.drop_constraint(
        "ck_plan_entitlements_feature_key",
        "plan_entitlements",
        type_="check",
    )
    op.create_check_constraint(
        "ck_plan_entitlements_feature_key",
        "plan_entitlements",
        "feature_key IN ("
        "'video_analysis', 'training_plan_generation', 'ai_coach_reply'"
        ")",
    )
    op.create_check_constraint(
        "ck_plan_entitlements_allowance_units",
        "plan_entitlements",
        "allowance_units >= 0",
    )
    op.create_check_constraint(
        "ck_plan_entitlements_reset_policy",
        "plan_entitlements",
        "reset_policy = 'calendar_month_utc'",
    )
    op.alter_column("plan_entitlements", "allowance_units", nullable=False)
    op.alter_column(
        "plan_entitlements",
        "reset_policy",
        nullable=False,
        server_default=sa.text("'calendar_month_utc'"),
    )
    op.drop_column("plan_entitlements", "entitlement_type")

    # The original schema required a provider price for Pro. Remove only an
    # unused, provider-unmapped seed row; otherwise stop rather than fabricate
    # payment data or discard an active membership.
    op.execute(
        """
        DELETE FROM plan_entitlements AS entitlement
        USING subscription_plans AS plan
        WHERE entitlement.plan_id = plan.id
          AND plan.code = 'pro'
          AND plan.stripe_price_id IS NULL
          AND NOT EXISTS (
              SELECT 1 FROM user_subscriptions WHERE plan_id = plan.id
          )
          AND NOT EXISTS (
              SELECT 1
              FROM feature_usage AS usage
              JOIN plan_entitlements AS referenced
                ON referenced.id = usage.entitlement_id
              WHERE referenced.plan_id = plan.id
          )
        """
    )
    op.execute(
        """
        DELETE FROM subscription_plans AS plan
        WHERE plan.code = 'pro'
          AND plan.stripe_price_id IS NULL
          AND NOT EXISTS (
              SELECT 1 FROM user_subscriptions WHERE plan_id = plan.id
          )
        """
    )
    op.drop_constraint(
        "ck_subscription_plans_price_mapping",
        "subscription_plans",
        type_="check",
    )
    op.create_check_constraint(
        "ck_subscription_plans_price_mapping",
        "subscription_plans",
        "(code = 'free' AND stripe_price_id IS NULL) "
        "OR (code = 'pro' AND stripe_price_id IS NOT NULL)",
    )
