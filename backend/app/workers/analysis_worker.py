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

    database_available: bool | None = None

    while True:
        try:
            check_database()

            if database_available is not True:
                print("Worker ready - database reachable.")

            database_available = True

        except SQLAlchemyError as exc:
            if database_available is not False:
                print(f"Worker database connection failed: {exc}")

            database_available = False

        time.sleep(POLL_INTERVAL_SECONDS)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\nAnalysis worker stopped.")
