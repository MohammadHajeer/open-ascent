import app.models  # noqa: F401
from app.db.base import Base

EXPECTED_APPLICATION_TABLES = {
    "profiles",
    "movements",
    "movement_documentation",
    "analyses",
    "workout_sessions",
    "workout_sets",
    "training_plans",
    "conversations",
    "messages",
    "ai_runs",
    "subscription_plans",
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
