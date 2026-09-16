"""External platform-managed tables referenced by application metadata.

These objects exist only so SQLAlchemy can resolve foreign keys.
Alembic must never create, alter, or drop them.
"""

from sqlalchemy import Column, Table
from sqlalchemy.dialects.postgresql import UUID

from app.db.base import Base


auth_users = Table(
    "users",
    Base.metadata,
    Column("id", UUID(as_uuid=True), primary_key=True),
    schema="auth",
    info={"external": True},
)
