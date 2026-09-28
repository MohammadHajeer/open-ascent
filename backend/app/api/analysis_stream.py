from __future__ import annotations

import asyncio
import json
import time
import uuid
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from fastapi.security import HTTPAuthorizationCredentials
from sqlalchemy import select
from sse_starlette.sse import EventSourceResponse

from app.api.dependencies.analysis_access import (
    bearer_scheme,
    require_analysis_access,
)
from app.db.database import SessionLocal
from app.models.analysis import Analysis
from app.models.analysis_event import AnalysisEvent
from app.services.analysis_availability import analysis_queue_snapshot

router = APIRouter(prefix="/analyses", tags=["Analysis"])
TERMINAL_STATUSES = frozenset({"failed", "expired"})
TERMINAL_EXPLANATION_STATUSES = frozenset({"completed", "failed", "skipped"})
WAITING_STATUSES = frozenset({"queued", "running"})
# Worker health changes on a heartbeat scale (seconds), so the queue snapshot
# is refreshed less often than the event table is polled.
QUEUE_REFRESH_SECONDS = 3.0


def read_progress(
    analysis_id: uuid.UUID, cursor: int
) -> tuple[list[AnalysisEvent], str, str, str, datetime | None]:
    with SessionLocal() as db:
        analysis = db.get(Analysis, analysis_id)
        if analysis is None:
            return [], "expired", "expired", "skipped", None
        events = list(
            db.scalars(
                select(AnalysisEvent)
                .where(
                    AnalysisEvent.analysis_id == analysis_id,
                    AnalysisEvent.id > cursor,
                )
                .order_by(AnalysisEvent.id)
                .limit(100)
            )
        )
        return (
            events,
            analysis.status,
            analysis.stage,
            analysis.ai_feedback_status,
            analysis.access_expires_at,
        )


def read_queue_status(analysis_id: uuid.UUID) -> dict | None:
    with SessionLocal() as db:
        analysis = db.get(Analysis, analysis_id)
        if analysis is None:
            return None
        snapshot = analysis_queue_snapshot(db, analysis)
        return snapshot.as_dict() if snapshot else None


async def stream_progress(request: Request, analysis_id: uuid.UUID, cursor: int):
    sent_state = False
    sent_queue: dict | None = None
    queue_checked_at: float | None = None
    while not await request.is_disconnected():
        (
            events,
            status,
            stage,
            explanation_status,
            access_expires_at,
        ) = await asyncio.to_thread(read_progress, analysis_id, cursor)
        if access_expires_at is not None and access_expires_at <= datetime.now(UTC):
            return
        for item in events:
            cursor = item.id
            yield {
                "id": str(item.id),
                "event": item.event_type,
                "data": json.dumps(item.payload, separators=(",", ":")),
            }

        # A new commit may have landed between the state read and the event
        # query. Read again before sending a state snapshot so it cannot
        # overwrite a newer stage just replayed from the event table.
        if events:
            continue

        if not sent_state:
            yield {
                "event": "state",
                "data": json.dumps(
                    {
                        "status": status,
                        "stage": stage,
                        "explanation_status": explanation_status,
                    },
                    separators=(",", ":"),
                ),
            }
            sent_state = True

        # Athlete-safe queue context (service state + jobs ahead) for work
        # that is still waiting. Sent only when it changes; carries no event
        # id so it never moves the replay cursor.
        now = time.monotonic()
        if status in WAITING_STATUSES and (
            queue_checked_at is None or now - queue_checked_at >= QUEUE_REFRESH_SECONDS
        ):
            queue_checked_at = now
            queue = await asyncio.to_thread(read_queue_status, analysis_id)
            if queue is not None and queue != sent_queue:
                sent_queue = queue
                yield {
                    "event": "queue",
                    "data": json.dumps(queue, separators=(",", ":")),
                }

        if status in TERMINAL_STATUSES or (
            status == "completed"
            and explanation_status in TERMINAL_EXPLANATION_STATUSES
        ):
            return
        await asyncio.sleep(1)


@router.get("/{analysis_id}/events")
def get_analysis_events(
    analysis_id: uuid.UUID,
    request: Request,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer_scheme)],
    last_event_id: Annotated[str | None, Header(alias="Last-Event-ID")] = None,
) -> EventSourceResponse:
    # Authenticate before opening the stream. Its database session closes here;
    # each later read gets its own short-lived session.
    with SessionLocal() as db:
        require_analysis_access(analysis_id, db, credentials)
        try:
            cursor = int(last_event_id) if last_event_id else 0
        except ValueError as exc:
            raise HTTPException(
                status_code=400, detail="Invalid event cursor."
            ) from exc
        if cursor < 0:
            raise HTTPException(status_code=400, detail="Invalid event cursor.")
        if (
            cursor
            and db.scalar(
                select(AnalysisEvent.id).where(
                    AnalysisEvent.analysis_id == analysis_id,
                    AnalysisEvent.id == cursor,
                )
            )
            is None
        ):
            cursor = 0

    return EventSourceResponse(
        stream_progress(request, analysis_id, cursor),
        ping=15,
        headers={"Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no"},
    )
