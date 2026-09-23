"""Ephemeral low-latency Coach snapshots; PostgreSQL remains authoritative."""

from __future__ import annotations

import asyncio
import threading
import time
import uuid
from dataclasses import dataclass


@dataclass(frozen=True)
class LiveSnapshot:
    id: str
    status: str
    content: str
    error_code: str | None
    updated_at: float

    def payload(self) -> dict:
        return {
            "id": self.id,
            "status": self.status,
            "content": self.content,
            "error_code": self.error_code,
        }


class CoachLiveHub:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._latest: dict[uuid.UUID, LiveSnapshot] = {}
        self._listeners: dict[
            uuid.UUID, set[tuple[asyncio.AbstractEventLoop, asyncio.Queue[LiveSnapshot]]]
        ] = {}

    @staticmethod
    def _offer(queue: asyncio.Queue[LiveSnapshot], snapshot: LiveSnapshot) -> None:
        if queue.full():
            queue.get_nowait()
        queue.put_nowait(snapshot)

    def publish(
        self,
        generation_id: uuid.UUID,
        status: str,
        content: str,
        error_code: str | None = None,
    ) -> None:
        with self._lock:
            previous = self._latest.get(generation_id)
            if previous and (
                previous.status,
                previous.content,
                previous.error_code,
            ) == (status, content, error_code):
                return
            now = time.monotonic()
            snapshot = LiveSnapshot(
                str(generation_id), status, content, error_code, now
            )
            self._latest[generation_id] = snapshot
            listeners = tuple(self._listeners.get(generation_id, ()))
            expired = [
                key
                for key, item in self._latest.items()
                if key not in self._listeners and now - item.updated_at > 300
            ]
            for key in expired:
                self._latest.pop(key, None)
        for loop, queue in listeners:
            if not loop.is_closed():
                try:
                    loop.call_soon_threadsafe(self._offer, queue, snapshot)
                except RuntimeError:
                    # The browser disconnected while the worker was publishing.
                    pass

    def subscribe(
        self, generation_id: uuid.UUID
    ) -> tuple[LiveSnapshot | None, asyncio.Queue[LiveSnapshot]]:
        loop = asyncio.get_running_loop()
        queue: asyncio.Queue[LiveSnapshot] = asyncio.Queue(maxsize=1)
        with self._lock:
            self._listeners.setdefault(generation_id, set()).add((loop, queue))
            return self._latest.get(generation_id), queue

    def current(self, generation_id: uuid.UUID) -> LiveSnapshot | None:
        with self._lock:
            return self._latest.get(generation_id)

    def unsubscribe(
        self, generation_id: uuid.UUID, queue: asyncio.Queue[LiveSnapshot]
    ) -> None:
        loop = asyncio.get_running_loop()
        with self._lock:
            listeners = self._listeners.get(generation_id)
            if listeners is not None:
                listeners.discard((loop, queue))
                if not listeners:
                    self._listeners.pop(generation_id, None)


live_hub = CoachLiveHub()
