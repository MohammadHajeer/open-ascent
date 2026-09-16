from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncGenerator

from fastapi import APIRouter, Request
from sse_starlette.sse import EventSourceResponse

router = APIRouter(prefix="/smoke", tags=["smoke"])


async def event_stream(request: Request) -> AsyncGenerator[dict[str, str], None]:
    for progress in (0, 25, 50, 75, 100):
        if await request.is_disconnected():
            print("SSE client disconnected.")
            break

        yield {
            "id": str(progress),
            "event": "progress",
            "data": json.dumps(
                {
                    "progress": progress,
                    "stage": "sse_smoke_test",
                }
            ),
        }

        await asyncio.sleep(1)


@router.get("/sse")
async def sse_smoke(request: Request) -> EventSourceResponse:
    return EventSourceResponse(event_stream(request))
