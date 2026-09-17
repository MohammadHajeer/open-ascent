from __future__ import annotations

import logging

import uvicorn
from watchfiles import PythonFilter, run_process

logging.basicConfig(
    level=logging.INFO,
    format="%(message)s",
)


def run_api() -> None:
    uvicorn.run(
        "app.main:app",
        host="127.0.0.1",
        port=8000,
        reload=False,
        log_level="info",
        access_log=False,
    )


if __name__ == "__main__":
    print("Watching backend/app for changes...")

    run_process(
        "app",
        target=run_api,
        watch_filter=PythonFilter(),
    )
