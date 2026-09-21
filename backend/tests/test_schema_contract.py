import app.models  # noqa: F401
from app.db.base import Base
from app.models.subscription import FeatureUsage, StripeWebhookEvent, UserSubscription

EXPECTED_APPLICATION_TABLES = {
    "profiles",
    "movements",
    "movement_documentation",
    "analyses",
    "analysis_events",
    "workout_sessions",
    "workout_sets",
    "training_plans",
    "conversations",
    "messages",
    "ai_runs",
    "subscription_plans",
    "stripe_webhook_events",
    "plan_entitlements",
    "user_subscriptions",
    "feature_usage",
}


def test_exact_application_table_set():
    public_tables = {
        table.name
        for table in Base.metadata.tables.values()
        if table.schema in (None, "public")
    }
    assert public_tables == EXPECTED_APPLICATION_TABLES


def test_auth_users_is_external_metadata_only():
    table = Base.metadata.tables["auth.users"]
    assert table.info.get("external") is True


def test_feature_usage_has_database_lifecycle_and_idempotency_guards():
    constraints = {constraint.name for constraint in FeatureUsage.__table__.constraints}
    indexes = {
        index.name: tuple(column.name for column in index.columns)
        for index in FeatureUsage.__table__.indexes
    }

    assert "uq_feature_usage_user_feature_operation" in constraints
    assert "ck_feature_usage_lifecycle_metadata" in constraints
    assert indexes["ix_feature_usage_quota_lookup"] == (
        "user_id",
        "feature_key",
        "window_start",
        "window_end",
        "status",
    )


def test_stripe_webhook_reconciliation_has_idempotency_and_ordering_guards():
    assert StripeWebhookEvent.__table__.primary_key.columns.keys() == ["id"]
    assert "provider_event_created_at" in UserSubscription.__table__.columns
