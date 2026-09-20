"""Allow a family-level guest intention without a movement target.

Revision ID: da520aeed891
Revises: 71c4ea9b20d5
"""

from alembic import op
import sqlalchemy as sa

revision = "da520aeed891"
down_revision = "71c4ea9b20d5"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("analyses", sa.Column("family_key", sa.Text(), nullable=True))
    op.execute("UPDATE analyses SET family_key = movements.family_key FROM movements WHERE analyses.movement_id = movements.id")
    op.alter_column("analyses", "movement_id", existing_type=sa.UUID(), nullable=True)
    op.create_check_constraint("ck_analyses_target_or_family", "analyses",
                               "(movement_id IS NOT NULL) OR (owner_kind = 'guest' AND family_key = 'vertical_pull')")


def downgrade() -> None:
    op.drop_constraint("ck_analyses_target_or_family", "analyses", type_="check")
    # Existing family-mode analyses must be handled explicitly before rollback.
    op.alter_column("analyses", "movement_id", existing_type=sa.UUID(), nullable=False)
    op.drop_column("analyses", "family_key")
