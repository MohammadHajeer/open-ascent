from __future__ import annotations

import logging
import uuid
from threading import Event, Lock, Thread

from sqlalchemy import func
from sqlalchemy.dialects.postgresql import insert

from app.db.database import SessionLocal
from app.models.worker_instance import WorkerInstance

logger = logging.getLogger(__name__)

HEARTBEAT_SECONDS = 10
STALE_AFTER_SECONDS = 30
FAILED_AFTER_SECONDS = 90


class WorkerMonitor:
    """One process-local identity, heartbeating regardless of job leases."""

    def __init__(self, worker_type: str) -> None:
        self.id = uuid.uuid4()
        self.worker_type = worker_type
        self._state = "idle"
        self._job_id: uuid.UUID | None = None
        self._lock = Lock()
        self._stop = Event()
        self._thread: Thread | None = None

    def _write(self) -> None:
        with self._lock:
            state, job_id = self._state, self._job_id
        with SessionLocal() as db:
            stmt = insert(WorkerInstance).values(
                id=self.id,
                worker_type=self.worker_type,
                state=state,
                current_job_id=job_id,
                started_at=func.now(),
                last_seen_at=func.now(),
            )
            db.execute(
                stmt.on_conflict_do_update(
                    index_elements=[WorkerInstance.id],
                    set_={
                        "state": state,
                        "current_job_id": job_id,
                        "last_seen_at": func.now(),
                    },
                )
            )
            db.commit()

    def _safe_write(self) -> None:
        try:
            self._write()
        except Exception:
            logger.exception(
                "Worker heartbeat failed: worker_type=%s id=%s",
                self.worker_type,
                self.id,
            )

    def start(self) -> None:
        self._safe_write()

        def loop() -> None:
            while not self._stop.wait(HEARTBEAT_SECONDS):
                self._safe_write()

        self._thread = Thread(
            target=loop, name=f"{self.worker_type}-heartbeat", daemon=True
        )
        self._thread.start()

    def set_job(self, job_id: uuid.UUID | None) -> None:
        with self._lock:
            self._job_id = job_id
            self._state = "busy" if job_id else "idle"
        self._safe_write()

    def set_busy(self, busy: bool) -> None:
        with self._lock:
            self._state = "busy" if busy else "idle"
        self._safe_write()

    def stop(self, *, failed: bool = False) -> None:
        self._stop.set()
        if self._thread:
            self._thread.join(timeout=1)
        with self._lock:
            self._state = "failed" if failed else "stopped"
            self._job_id = None
        self._safe_write()
