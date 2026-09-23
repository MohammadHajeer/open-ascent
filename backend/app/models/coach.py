from __future__ import annotations

import uuid

from sqlalchemy import (
    CheckConstraint,
    ForeignKey,
    Integer,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.models.mixins import TimestampMixin


class Conversation(TimestampMixin, Base):
    __tablename__ = "conversations"
    __table_args__ = (
        UniqueConstraint(
            "openai_conversation_id", name="uq_conversations_openai_conversation_id"
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("profiles.id", ondelete="CASCADE"),
        nullable=False,
    )
    title: Mapped[str] = mapped_column(Text, nullable=False)
    openai_conversation_id: Mapped[str | None] = mapped_column(Text, nullable=True)


class Message(TimestampMixin, Base):
    __tablename__ = "messages"
    __table_args__ = (
        UniqueConstraint(
            "conversation_id", "position", name="uq_messages_conversation_position"
        ),
        CheckConstraint("position >= 0", name="ck_messages_position"),
        CheckConstraint("role IN ('user', 'assistant')", name="ck_messages_role"),
        CheckConstraint(
            "status IN ('streaming', 'completed', 'failed', 'interrupted')",
            name="ck_messages_status",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    conversation_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("conversations.id", ondelete="CASCADE"),
        nullable=False,
    )
    position: Mapped[int] = mapped_column(Integer, nullable=False)
    role: Mapped[str] = mapped_column(Text, nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(
        Text, nullable=False, server_default=text("'completed'")
    )


class CoachGeneration(TimestampMixin, Base):
    __tablename__ = "coach_generations"
    __table_args__ = (
        UniqueConstraint(
            "conversation_id", "client_request_id", name="uq_coach_generation_request"
        ),
        UniqueConstraint("user_message_id", name="uq_coach_generation_user_message"),
        UniqueConstraint(
            "assistant_message_id", name="uq_coach_generation_assistant_message"
        ),
        CheckConstraint(
            "status IN ('reserved', 'requesting', 'streaming', 'completed', 'failed', 'interrupted')",
            name="ck_coach_generations_status",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    conversation_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("conversations.id", ondelete="CASCADE"),
        nullable=False,
    )
    user_message_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("messages.id", ondelete="CASCADE"),
        nullable=False,
    )
    assistant_message_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("messages.id", ondelete="CASCADE"),
        nullable=False,
    )
    client_request_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), nullable=False
    )
    feature_usage_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("feature_usage.id", ondelete="SET NULL"),
        nullable=True,
        unique=True,
    )
    provider_response_id: Mapped[str | None] = mapped_column(
        Text, nullable=True, unique=True
    )
    status: Mapped[str] = mapped_column(
        Text, nullable=False, server_default=text("'reserved'")
    )
    error_code: Mapped[str | None] = mapped_column(Text, nullable=True)
