from __future__ import annotations

import time

from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

from app.db.database import engine

POLL_INTERVAL_SECONDS = 5


def check_database() -> None:
    with engine.connect() as connection:
        connection.execute(text("SELECT 1"))


def main() -> None:
    print("Open Ascent analysis worker started.")

    while True:
        try:
            check_database()
            print("Worker alive — database reachable, waiting for analyses...")
        except SQLAlchemyError as exc:
            print(f"Worker database check failed: {exc}")

        time.sleep(POLL_INTERVAL_SECONDS)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\nAnalysis worker stopped.")
