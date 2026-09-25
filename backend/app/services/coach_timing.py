"""Development-only Coach latency marks; logged server-side, never sent to clients."""

from __future__ import annotations

import json
import logging
import threading
import time
import uuid
from contextvars import ContextVar

from app.core.config import settings

logger = logging.getLogger("app.coach.timing")
_current: ContextVar[CoachTimeline | None] = ContextVar("coach_timeline", default=None)
_attached: dict[uuid.UUID, CoachTimeline] = {}
_lock = threading.Lock()


def enabled() -> bool:
    return settings.app_env != "production" or settings.coach_timing_log


class CoachTimeline:
    """Millisecond offsets from the Send request; first occurrence of each mark wins."""

    def __init__(self) -> None:
        self.started = time.perf_counter()
        self.marks: dict[str, float] = {"request_received": 0.0}
        self.counts: dict[str, int] = {}
        self.labels: dict[str, str] = {}

    def mark(self, name: str) -> None:
        if name not in self.marks:
            self.marks[name] = round((time.perf_counter() - self.started) * 1000, 1)

    def count(self, name: str, amount: int = 1) -> None:
        self.counts[name] = self.counts.get(name, 0) + amount

    def summary(self) -> dict:
        return {"marks_ms": self.marks, "counts": self.counts, **self.labels}


def request_timeline() -> CoachTimeline | None:
    """FastAPI dependency; declare it first so it runs before authentication."""
    return CoachTimeline() if enabled() else None


def activate(timeline: CoachTimeline | None) -> None:
    _current.set(timeline)


def mark(name: str) -> None:
    if (timeline := _current.get()) is not None:
        timeline.mark(name)


def count(name: str, amount: int = 1) -> None:
    if (timeline := _current.get()) is not None:
        timeline.count(name, amount)


def label(name: str, value: str) -> None:
    if (timeline := _current.get()) is not None:
        timeline.labels[name] = value


def attach(generation_id: uuid.UUID, timeline: CoachTimeline | None) -> None:
    if timeline is not None:
        with _lock:
            _attached[generation_id] = timeline


def resume(generation_id: uuid.UUID) -> None:
    """Continue the Send request's timeline inside the generation worker thread."""
    with _lock:
        _current.set(_attached.get(generation_id))


def mark_generation(generation_id: uuid.UUID, name: str) -> None:
    with _lock:
        timeline = _attached.get(generation_id)
    if timeline is not None:
        timeline.mark(name)


def finish(generation_id: uuid.UUID | None = None) -> None:
    timeline = _current.get()
    if generation_id is not None:
        with _lock:
            timeline = _attached.pop(generation_id, None) or timeline
    if timeline is not None:
        logger.info("coach_timing %s", json.dumps(timeline.summary(), sort_keys=True))
    _current.set(None)
