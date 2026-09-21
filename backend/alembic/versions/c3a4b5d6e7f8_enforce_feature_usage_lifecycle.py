"""enforce feature usage lifecycle

Revision ID: c3a4b5d6e7f8
Revises: f1e2d3c4b5a6
"""

from alembic import op

revision = "c3a4b5d6e7f8"
down_revision = "f1e2d3c4b5a6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "UPDATE feature_usage SET release_reason = NULL "
        "WHERE status IN ('reserved', 'consumed')"
    )
    op.execute(
        "UPDATE feature_usage SET release_reason = 'legacy_release' "
        "WHERE status = 'released' AND release_reason IS NULL"
    )
    op.drop_constraint("ck_feature_usage_settlement", "feature_usage", type_="check")
    op.create_check_constraint(
        "ck_feature_usage_lifecycle_metadata",
        "feature_usage",
        """
        (status = 'reserved' AND settled_at IS NULL AND release_reason IS NULL)
        OR (status = 'consumed' AND settled_at IS NOT NULL
            AND release_reason IS NULL)
        OR (status = 'released' AND settled_at IS NOT NULL
            AND release_reason IS NOT NULL)
        """,
    )
    op.drop_index("ix_feature_usage_quota_lookup", table_name="feature_usage")
    op.create_index(
        "ix_feature_usage_quota_lookup",
        "feature_usage",
        ["user_id", "feature_key", "window_start", "window_end", "status"],
    )
    op.execute(
        """
        CREATE FUNCTION public.enforce_feature_usage_transition()
        RETURNS trigger
        LANGUAGE plpgsql
        SET search_path = ''
        AS $$
        BEGIN
            IF OLD.user_id IS DISTINCT FROM NEW.user_id
               OR OLD.entitlement_id IS DISTINCT FROM NEW.entitlement_id
               OR OLD.feature_key IS DISTINCT FROM NEW.feature_key
               OR OLD.operation_key IS DISTINCT FROM NEW.operation_key
               OR OLD.request_fingerprint IS DISTINCT FROM NEW.request_fingerprint
               OR OLD.units IS DISTINCT FROM NEW.units
               OR OLD.window_start IS DISTINCT FROM NEW.window_start
               OR OLD.window_end IS DISTINCT FROM NEW.window_end THEN
                RAISE EXCEPTION 'feature usage accounting identity is immutable'
                    USING ERRCODE = '23514';
            END IF;

            IF OLD.status IS DISTINCT FROM NEW.status
               AND NOT (
                   OLD.status = 'reserved'
                   AND NEW.status IN ('consumed', 'released')
               ) THEN
                RAISE EXCEPTION 'invalid feature usage transition: % -> %',
                    OLD.status, NEW.status
                    USING ERRCODE = '23514';
            END IF;
            RETURN NEW;
        END;
        $$
        """
    )
    op.execute(
        """
        CREATE TRIGGER enforce_feature_usage_transition_before_update
        BEFORE UPDATE ON public.feature_usage
        FOR EACH ROW EXECUTE FUNCTION public.enforce_feature_usage_transition()
        """
    )


def downgrade() -> None:
    op.execute(
        "DROP TRIGGER IF EXISTS enforce_feature_usage_transition_before_update "
        "ON public.feature_usage"
    )
    op.execute("DROP FUNCTION IF EXISTS public.enforce_feature_usage_transition()")
    op.drop_index("ix_feature_usage_quota_lookup", table_name="feature_usage")
    op.create_index(
        "ix_feature_usage_quota_lookup",
        "feature_usage",
        ["user_id", "feature_key", "window_start", "status"],
    )
    op.drop_constraint(
        "ck_feature_usage_lifecycle_metadata", "feature_usage", type_="check"
    )
    op.create_check_constraint(
        "ck_feature_usage_settlement",
        "feature_usage",
        """
        (status = 'reserved' AND settled_at IS NULL)
        OR (status IN ('consumed', 'released') AND settled_at IS NOT NULL)
        """,
    )
