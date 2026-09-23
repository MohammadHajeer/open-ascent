"""Classify seeded movements for plan prescriptions.

Revision ID: c6d7e8f9a012
Revises: c5d6e7f8a901
"""

import sqlalchemy as sa
from alembic import op

revision = "c6d7e8f9a012"
down_revision = "c5d6e7f8a901"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("movements", sa.Column("prescription_type", sa.Text(), nullable=True))
    op.create_check_constraint(
        "ck_movements_prescription_type",
        "movements",
        "prescription_type IN ('repetitions', 'duration')",
    )
    op.execute(
        sa.text(
            """
            UPDATE movements
            SET prescription_type = CASE
                WHEN slug IN ('front-lever', 'back-lever') THEN 'duration'
                WHEN slug IN (
                    'pull-up', 'chin-up', 'close-grip-pull-up',
                    'wide-grip-pull-up', 'high-pull-up', 'muscle-up',
                    'dips', 'push-up', 'inverted-deadlift'
                ) THEN 'repetitions'
            END
            WHERE prescription_type IS NULL
              AND slug IN (
                  'front-lever', 'back-lever', 'pull-up', 'chin-up',
                  'close-grip-pull-up', 'wide-grip-pull-up', 'high-pull-up',
                  'muscle-up', 'dips', 'push-up', 'inverted-deadlift'
              )
            """
        )
    )


def downgrade() -> None:
    op.drop_constraint("ck_movements_prescription_type", "movements", type_="check")
    op.drop_column("movements", "prescription_type")
