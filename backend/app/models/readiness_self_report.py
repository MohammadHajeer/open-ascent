"""Owner-scoped provisional answers to published foundation readiness rules."""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, Text, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class ReadinessSelfReport(Base):
    __tablename__ = "readiness_self_reports"
    __table_args__ = (
        CheckConstraint("response IN ('able', 'not_yet', 'avoid')", name="ck_readiness_self_reports_response"),
        CheckConstraint("source = 'structured_self_report'", name="ck_readiness_self_reports_source"),
        Index("ix_readiness_self_reports_owner_rule", "user_id", "movement_id", "rule_code", "reported_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()"))
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("profiles.id", ondelete="CASCADE"), nullable=False)
    movement_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("movements.id", ondelete="RESTRICT"), nullable=False)
    documentation_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("movement_documentation.id", ondelete="RESTRICT"), nullable=False)
    rule_code: Mapped[str] = mapped_column(Text, nullable=False)
    source: Mapped[str] = mapped_column(Text, nullable=False, server_default=text("'structured_self_report'"))
    response: Mapped[str] = mapped_column(Text, nullable=False)
    reported_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=text("now()"))
