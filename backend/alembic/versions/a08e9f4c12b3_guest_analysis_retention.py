"""Keep minimal guest statistics after temporary data expires.

Revision ID: a08e9f4c12b3
Revises: c27a5dc81e03
"""

from alembic import op
import sqlalchemy as sa

revision = "a08e9f4c12b3"
down_revision = "c27a5dc81e03"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("analyses", sa.Column("guest_cleaned_at", sa.DateTime(timezone=True)))
    op.add_column("analyses", sa.Column("completed_at", sa.DateTime(timezone=True)))
    op.add_column("analyses", sa.Column("failed_at", sa.DateTime(timezone=True)))
    op.add_column("analyses", sa.Column("terminal_outcome", sa.Text()))
    op.add_column("analyses", sa.Column("valid_rep_count", sa.Integer()))
    op.add_column("analyses", sa.Column("partial_rep_count", sa.Integer()))
    op.add_column("analyses", sa.Column("uncertain_rep_count", sa.Integer()))
    op.execute("""
        UPDATE analyses SET
          completed_at = CASE WHEN status = 'completed' THEN COALESCE(
            (SELECT MIN(e.created_at) FROM analysis_events e
             WHERE e.analysis_id = analyses.id AND e.event_type = 'completed'),
            updated_at) END,
          failed_at = CASE WHEN status = 'failed' THEN COALESCE(
            (SELECT MIN(e.created_at) FROM analysis_events e
             WHERE e.analysis_id = analyses.id AND e.event_type = 'failed'),
            updated_at) END,
          terminal_outcome = CASE WHEN result->>'outcome' IN
            ('completed', 'zero_valid_reps', 'insufficient_evidence')
            THEN result->>'outcome' END,
          valid_rep_count = CASE WHEN (result->>'valid_rep_count') ~ '^[0-9]+$'
            THEN (result->>'valid_rep_count')::integer END,
          partial_rep_count = CASE WHEN (result->>'partial_rep_count') ~ '^[0-9]+$'
            THEN (result->>'partial_rep_count')::integer END,
          uncertain_rep_count = CASE WHEN (result->>'uncertain_rep_count') ~ '^[0-9]+$'
            THEN (result->>'uncertain_rep_count')::integer END
        WHERE status IN ('completed', 'failed')
    """)
    for column in (
        "safety_documentation_id",
        "safety_ack_version",
        "safety_acknowledged_at",
        "reservation_operation_key",
        "request_fingerprint",
        "reservation_expires_at",
    ):
        op.alter_column("analyses", column, nullable=True)
    op.drop_constraint("ck_analyses_ownership_shape", "analyses", type_="check")
    op.create_check_constraint(
        "ck_analyses_ownership_shape",
        "analyses",
        """
        (owner_kind = 'guest' AND user_id IS NULL AND feature_usage_id IS NULL
         AND ((guest_cleaned_at IS NULL AND guest_token_hash IS NOT NULL
               AND guest_rate_key IS NOT NULL AND access_expires_at IS NOT NULL
               AND purge_after IS NOT NULL)
              OR (guest_cleaned_at IS NOT NULL AND guest_token_hash IS NULL
                  AND guest_rate_key IS NULL AND access_expires_at IS NULL
                  AND purge_after IS NULL)))
        OR (owner_kind = 'authenticated' AND user_id IS NOT NULL
            AND guest_cleaned_at IS NULL
            AND guest_token_hash IS NULL AND guest_rate_key IS NULL
            AND access_expires_at IS NULL AND purge_after IS NULL)
        """,
    )
    op.create_check_constraint(
        "ck_analyses_terminal_outcome",
        "analyses",
        "terminal_outcome IS NULL OR terminal_outcome IN "
        "('completed', 'zero_valid_reps', 'insufficient_evidence')",
    )
    op.create_check_constraint(
        "ck_analyses_rep_counts",
        "analyses",
        "(valid_rep_count IS NULL OR valid_rep_count >= 0) AND "
        "(partial_rep_count IS NULL OR partial_rep_count >= 0) AND "
        "(uncertain_rep_count IS NULL OR uncertain_rep_count >= 0)",
    )
    op.create_check_constraint(
        "ck_analyses_cleanup_shape",
        "analyses",
        "(guest_cleaned_at IS NULL AND safety_documentation_id IS NOT NULL "
        "AND safety_ack_version IS NOT NULL AND safety_acknowledged_at IS NOT NULL "
        "AND reservation_operation_key IS NOT NULL AND request_fingerprint IS NOT NULL "
        "AND reservation_expires_at IS NOT NULL) OR "
        "(guest_cleaned_at IS NOT NULL AND owner_kind = 'guest' "
        "AND safety_documentation_id IS NULL AND safety_ack_version IS NULL "
        "AND safety_acknowledged_at IS NULL AND reservation_operation_key IS NULL "
        "AND request_fingerprint IS NULL AND reservation_expires_at IS NULL "
        "AND video_path IS NULL AND result IS NULL AND ai_explanation IS NULL)",
    )
    op.create_index(
        "ix_analyses_guest_cleanup",
        "analyses",
        ["owner_kind", "guest_cleaned_at", "access_expires_at"],
    )


def downgrade() -> None:
    # Downgrading would require deleting scrubbed statistics or restoring secrets.
    op.execute("""
        DO $$ BEGIN
          IF EXISTS (SELECT 1 FROM analyses WHERE guest_cleaned_at IS NOT NULL) THEN
            RAISE EXCEPTION 'Cannot downgrade with cleaned guest statistics';
          END IF;
        END $$;
    """)
    op.drop_index("ix_analyses_guest_cleanup", table_name="analyses")
    op.drop_constraint("ck_analyses_cleanup_shape", "analyses", type_="check")
    op.drop_constraint("ck_analyses_rep_counts", "analyses", type_="check")
    op.drop_constraint("ck_analyses_terminal_outcome", "analyses", type_="check")
    op.drop_constraint("ck_analyses_ownership_shape", "analyses", type_="check")
    op.create_check_constraint(
        "ck_analyses_ownership_shape",
        "analyses",
        """
        (owner_kind = 'guest' AND user_id IS NULL AND guest_token_hash IS NOT NULL
         AND guest_rate_key IS NOT NULL AND access_expires_at IS NOT NULL
         AND purge_after IS NOT NULL AND feature_usage_id IS NULL)
        OR (owner_kind = 'authenticated' AND user_id IS NOT NULL
            AND guest_token_hash IS NULL AND guest_rate_key IS NULL
            AND access_expires_at IS NULL AND purge_after IS NULL)
        """,
    )
    for column in (
        "safety_documentation_id",
        "safety_ack_version",
        "safety_acknowledged_at",
        "reservation_operation_key",
        "request_fingerprint",
        "reservation_expires_at",
    ):
        op.alter_column("analyses", column, nullable=False)
    for column in (
        "uncertain_rep_count",
        "partial_rep_count",
        "valid_rep_count",
        "terminal_outcome",
        "failed_at",
        "completed_at",
        "guest_cleaned_at",
    ):
        op.drop_column("analyses", column)
