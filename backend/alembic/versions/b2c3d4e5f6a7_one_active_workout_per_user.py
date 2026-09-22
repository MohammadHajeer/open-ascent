"""Close empty duplicate workouts and enforce one active workout per user.

Revision ID: b2c3d4e5f6a7
Revises: a1b2c3d4e5f6
"""

import sqlalchemy as sa
from alembic import op

revision = "b2c3d4e5f6a7"
down_revision = "a1b2c3d4e5f6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    connection = op.get_bind()
    # Hold writes while selecting survivors, closing empty rows and creating the
    # index. This also avoids a new duplicate appearing during the migration.
    connection.execute(sa.text("LOCK TABLE workout_sessions IN SHARE ROW EXCLUSIVE MODE"))
    connection.execute(sa.text("LOCK TABLE workout_sets IN SHARE ROW EXCLUSIVE MODE"))
    rows = connection.execute(
        sa.text(
            """
            SELECT s.id, s.user_id, s.started_at, count(ws.id) AS set_count
            FROM workout_sessions s
            LEFT JOIN workout_sets ws ON ws.session_id = s.id
            WHERE s.completed_at IS NULL
            GROUP BY s.id
            ORDER BY s.user_id, (count(ws.id) > 0) DESC,
                     s.started_at DESC, s.id DESC
            """
        )
    ).mappings()
    seen_users = set()
    close_ids = []
    meaningful_duplicates = []
    for row in rows:
        if row["user_id"] not in seen_users:
            seen_users.add(row["user_id"])
        elif row["set_count"]:
            meaningful_duplicates.append(str(row["id"]))
        else:
            close_ids.append(row["id"])
    if meaningful_duplicates:
        raise RuntimeError(
            "Duplicate active workouts contain sets and need athlete-reviewed "
            "finish times before this migration: " + ", ".join(meaningful_duplicates)
        )
    if close_ids:
        connection.execute(
            sa.text(
                """
                UPDATE workout_sessions
                SET completed_at = started_at,
                    notes = concat_ws(E'\\n', nullif(notes, ''),
                        'Closed during active-workout duplicate cleanup (empty session).'),
                    updated_at = now()
                WHERE id = ANY(:ids) AND completed_at IS NULL
                """
            ),
            {"ids": close_ids},
        )
    op.create_index(
        "uq_workout_sessions_one_active_per_user",
        "workout_sessions",
        ["user_id"],
        unique=True,
        postgresql_where=sa.text("completed_at IS NULL"),
    )


def downgrade() -> None:
    op.drop_index("uq_workout_sessions_one_active_per_user", table_name="workout_sessions")
    # Closed historical rows remain closed; reopening them would reintroduce bad data.
