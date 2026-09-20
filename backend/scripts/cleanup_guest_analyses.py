"""Run one bounded guest cleanup pass: uv run python -m scripts.cleanup_guest_analyses"""

from __future__ import annotations

from app.db.database import SessionLocal
from app.services.guest_cleanup import cleanup_expired_guest_analyses

if __name__ == "__main__":
    with SessionLocal() as db:
        print(cleanup_expired_guest_analyses(db))
