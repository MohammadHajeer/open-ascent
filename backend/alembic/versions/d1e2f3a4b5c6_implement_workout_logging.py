"""Implement structured workout logging.

Revision ID: d1e2f3a4b5c6
Revises: c0a1b2c3d4e5
"""

from alembic import op
import sqlalchemy as sa

revision = "d1e2f3a4b5c6"
down_revision = "c0a1b2c3d4e5"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("workout_sessions", sa.Column("notes", sa.Text(), nullable=True))
    op.add_column("workout_sets", sa.Column("performer", sa.Text(), nullable=True))
    op.add_column("workout_sets", sa.Column("intent", sa.Text(), nullable=True))
    op.add_column(
        "workout_sets",
        sa.Column("live_coach_session_ref", sa.Text(), nullable=True),
    )
    op.execute(
        "UPDATE workout_sets SET performer = 'unknown', intent = 'training_set'"
    )
    op.alter_column("workout_sets", "performer", nullable=False)
    op.alter_column("workout_sets", "intent", nullable=False)
    op.drop_constraint("ck_workout_sets_primary_value", "workout_sets", type_="check")
    op.drop_constraint(
        "ck_workout_sets_analysis_segment_pair", "workout_sets", type_="check"
    )
    op.drop_index("uq_workout_sets_analysis_segment", table_name="workout_sets")
    op.create_check_constraint(
        "ck_workout_sets_primary_value",
        "workout_sets",
        "(reps IS NOT NULL AND reps > 0 AND hold_seconds IS NULL) "
        "OR (reps IS NULL AND hold_seconds IS NOT NULL AND hold_seconds > 0)",
    )
    op.create_check_constraint(
        "ck_workout_sets_analysis_segment_pair",
        "workout_sets",
        "analysis_segment_key IS NULL OR analysis_id IS NOT NULL",
    )
    op.create_check_constraint(
        "ck_workout_sets_performer",
        "workout_sets",
        "performer IN ('self', 'other', 'unknown')",
    )
    op.create_check_constraint(
        "ck_workout_sets_intent",
        "workout_sets",
        "intent IN ('training_set', 'assessment', 'max_test', 'skill_attempt')",
    )
    op.create_check_constraint(
        "ck_workout_sets_analysis_source",
        "workout_sets",
        "(source = 'uploaded_analysis' AND analysis_id IS NOT NULL) "
        "OR (source <> 'uploaded_analysis' AND analysis_id IS NULL)",
    )
    op.create_check_constraint(
        "ck_workout_sets_live_coach_source",
        "workout_sets",
        "live_coach_session_ref IS NULL OR source = 'live_coach'",
    )
    op.create_index(
        "uq_workout_sets_analysis_segment",
        "workout_sets",
        ["analysis_id", "analysis_segment_key"],
        unique=True,
        postgresql_where=sa.text(
            "analysis_id IS NOT NULL AND analysis_segment_key IS NOT NULL"
        ),
    )


def downgrade() -> None:
    op.drop_index("uq_workout_sets_analysis_segment", table_name="workout_sets")
    op.drop_constraint(
        "ck_workout_sets_live_coach_source", "workout_sets", type_="check"
    )
    op.drop_constraint(
        "ck_workout_sets_analysis_source", "workout_sets", type_="check"
    )
    op.drop_constraint("ck_workout_sets_intent", "workout_sets", type_="check")
    op.drop_constraint("ck_workout_sets_performer", "workout_sets", type_="check")
    op.drop_constraint(
        "ck_workout_sets_analysis_segment_pair", "workout_sets", type_="check"
    )
    op.drop_constraint("ck_workout_sets_primary_value", "workout_sets", type_="check")
    op.create_check_constraint(
        "ck_workout_sets_primary_value",
        "workout_sets",
        "(reps IS NOT NULL AND reps >= 0 AND hold_seconds IS NULL) "
        "OR (reps IS NULL AND hold_seconds IS NOT NULL AND hold_seconds > 0)",
    )
    op.create_check_constraint(
        "ck_workout_sets_analysis_segment_pair",
        "workout_sets",
        "(analysis_id IS NULL AND analysis_segment_key IS NULL) "
        "OR (analysis_id IS NOT NULL AND analysis_segment_key IS NOT NULL)",
    )
    op.create_index(
        "uq_workout_sets_analysis_segment",
        "workout_sets",
        ["analysis_id", "analysis_segment_key"],
        unique=True,
        postgresql_where=sa.text("analysis_id IS NOT NULL"),
    )
    op.drop_column("workout_sets", "live_coach_session_ref")
    op.drop_column("workout_sets", "intent")
    op.drop_column("workout_sets", "performer")
    op.drop_column("workout_sessions", "notes")
