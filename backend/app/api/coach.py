from __future__ import annotations

import asyncio
import json
import uuid
from datetime import UTC, datetime, timedelta
from typing import Literal

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import select
from sse_starlette.sse import EventSourceResponse

from app.api.dependencies.auth import AthleteProfile
from app.db.database import DbSession, SessionLocal
from app.models.coach import CoachGeneration, Conversation, Message
from app.models.training import TrainingPlanPreview
from app.services import coach as service
from app.services.coach_live import LiveSnapshot, live_hub
from app.services.entitlements import UnconfiguredAllowanceError
from app.services.feature_usage import (
    FeatureAccessDeniedError,
    QuotaExceededError,
    consume_usage,
    release_usage,
)

router = APIRouter(prefix="/coach/conversations", tags=["coach"])
TERMINAL = ("completed", "failed", "interrupted")


class SendInput(BaseModel):
    client_request_id: uuid.UUID
    content: str = Field(min_length=1, max_length=4000)
    kind: Literal["chat", "plan"] = "chat"


class TitleInput(BaseModel):
    title: str = Field(min_length=1, max_length=80)


def _conversation(conversation: Conversation) -> dict:
    return {
        "id": str(conversation.id),
        "title": conversation.title,
        "created_at": conversation.created_at.isoformat(),
        "updated_at": conversation.updated_at.isoformat(),
    }


def _message(message: Message) -> dict:
    return {
        "id": str(message.id),
        "role": message.role,
        "content": message.content,
        "status": message.status,
        "created_at": message.created_at.isoformat(),
    }


def _generation(generation: CoachGeneration, message: Message) -> dict:
    return {
        "id": str(generation.id),
        "status": generation.status,
        "content": message.content,
        "error_code": generation.error_code,
    }


@router.get("")
def list_conversations(profile: AthleteProfile, db: DbSession) -> list[dict]:
    return [
        _conversation(item)
        for item in db.scalars(
            select(Conversation)
            .where(Conversation.user_id == profile.id)
            .order_by(Conversation.updated_at.desc())
            .limit(50)
        )
    ]


@router.post("", status_code=201)
def create_conversation(profile: AthleteProfile, db: DbSession) -> dict:
    conversation = Conversation(user_id=profile.id, title="New chat")
    db.add(conversation)
    db.commit()
    db.refresh(conversation)
    return _conversation(conversation)


@router.post("/messages", status_code=202)
def send_first_message(payload: SendInput, profile: AthleteProfile, db: DbSession) -> dict:
    content = payload.content.strip()
    if not content:
        raise HTTPException(422, "Message cannot be blank.")
    try:
        conversation, generation, created = service.create_and_reserve_generation(
            db, profile, payload.client_request_id, content, kind=payload.kind
        )
    except ValueError as exc:
        raise HTTPException(409, str(exc)) from exc
    except (
        FeatureAccessDeniedError,
        QuotaExceededError,
        UnconfiguredAllowanceError,
    ) as exc:
        raise HTTPException(
            403,
            "Training plan generation is unavailable or its monthly allowance is exhausted."
            if payload.kind == "plan"
            else "AI Coach requires an available Pro entitlement.",
        ) from exc
    if created and generation.status == "reserved":
        service.start_generation(generation.id, profile.id)
    return {
        "conversation": _conversation(conversation),
        "generation_id": str(generation.id),
        "created": created,
    }


@router.get("/{conversation_id}")
def get_conversation(
    conversation_id: uuid.UUID, profile: AthleteProfile, db: DbSession
) -> dict:
    conversation = service.owned_conversation(db, profile.id, conversation_id)
    if conversation is None:
        raise HTTPException(404, "Conversation not found.")
    generation_by_message = {
        item.assistant_message_id: item.id
        for item in db.scalars(
            select(CoachGeneration).where(
                CoachGeneration.conversation_id == conversation.id
            )
        )
    }
    previews_by_generation = {
        item.coach_generation_id: item.id
        for item in db.scalars(
            select(TrainingPlanPreview)
            .join(CoachGeneration, CoachGeneration.id == TrainingPlanPreview.coach_generation_id)
            .where(
                TrainingPlanPreview.user_id == profile.id,
                CoachGeneration.conversation_id == conversation.id,
            )
        )
    }
    return {
        **_conversation(conversation),
        "messages": [
            {
                **_message(item),
                "generation_id": str(generation_by_message[item.id])
                if item.id in generation_by_message
                else None,
                "plan_preview_id": str(previews_by_generation[generation_by_message[item.id]])
                if item.id in generation_by_message
                and generation_by_message[item.id] in previews_by_generation
                else None,
            }
            for item in service.conversation_messages(db, conversation.id)
        ],
    }


@router.patch("/{conversation_id}")
def rename_conversation(
    conversation_id: uuid.UUID,
    payload: TitleInput,
    profile: AthleteProfile,
    db: DbSession,
) -> dict:
    conversation = service.owned_conversation(db, profile.id, conversation_id)
    if conversation is None:
        raise HTTPException(404, "Conversation not found.")
    title = " ".join(payload.title.split())
    if not title:
        raise HTTPException(422, "Title cannot be blank.")
    conversation.title = title
    conversation.updated_at = datetime.now(UTC)
    db.commit()
    db.refresh(conversation)
    return _conversation(conversation)


@router.post("/{conversation_id}/messages", status_code=202)
def send_message(
    conversation_id: uuid.UUID,
    payload: SendInput,
    profile: AthleteProfile,
    db: DbSession,
) -> dict:
    try:
        generation, created = service.reserve_generation(
            db,
            profile,
            conversation_id,
            payload.client_request_id,
            payload.content.strip(),
            kind=payload.kind,
        )
    except LookupError as exc:
        raise HTTPException(404, "Conversation not found.") from exc
    except ValueError as exc:
        raise HTTPException(409, str(exc)) from exc
    except (
        FeatureAccessDeniedError,
        QuotaExceededError,
        UnconfiguredAllowanceError,
    ) as exc:
        raise HTTPException(
            403,
            "Training plan generation is unavailable or its monthly allowance is exhausted."
            if payload.kind == "plan"
            else "AI Coach requires an available Pro entitlement.",
        ) from exc
    except RuntimeError as exc:
        raise HTTPException(409, str(exc)) from exc
    if created and generation.status == "reserved":
        service.start_generation(generation.id, profile.id)
    return {"generation_id": str(generation.id), "created": created}


def _read_generation(
    user_id: uuid.UUID, conversation_id: uuid.UUID, generation_id: uuid.UUID
) -> dict | None:
    with SessionLocal() as db:
        conversation = service.owned_conversation(db, user_id, conversation_id)
        if conversation is None:
            return None
        generation = db.scalar(
            select(CoachGeneration).where(
                CoachGeneration.id == generation_id,
                CoachGeneration.conversation_id == conversation_id,
            )
        )
        if generation is None:
            return None
        if generation.status in service.ACTIVE and generation.updated_at.replace(
            tzinfo=UTC
        ) < datetime.now(UTC) - timedelta(minutes=5):
            prior_status = generation.status
            generation.status = "interrupted"
            generation.error_code = "worker_lost"
            db.get(Message, generation.assistant_message_id).status = "interrupted"
            if generation.feature_usage_id:
                if prior_status == "reserved":
                    release_usage(
                        db,
                        generation.feature_usage_id,
                        reason="worker_lost_before_request",
                    )
                else:
                    consume_usage(db, generation.feature_usage_id)
            db.commit()
        return _generation(generation, db.get(Message, generation.assistant_message_id))


@router.get("/{conversation_id}/generations/{generation_id}")
def get_generation(
    conversation_id: uuid.UUID, generation_id: uuid.UUID, profile: AthleteProfile
) -> dict:
    value = _read_generation(profile.id, conversation_id, generation_id)
    if value is None:
        raise HTTPException(404, "Generation not found.")
    return value


@router.get("/{conversation_id}/generations/{generation_id}/events")
async def generation_events(
    conversation_id: uuid.UUID,
    generation_id: uuid.UUID,
    profile: AthleteProfile,
    request: Request,
) -> EventSourceResponse:
    durable = await asyncio.to_thread(
        _read_generation, profile.id, conversation_id, generation_id
    )
    if durable is None:
        raise HTTPException(404, "Generation not found.")

    def prefer_live(saved: dict, live: LiveSnapshot | None) -> dict:
        if saved["status"] in TERMINAL or live is None:
            return saved
        if live.status in TERMINAL or len(live.content) >= len(saved["content"]):
            return live.payload()
        return saved

    async def events():
        previous = None
        current, queue = live_hub.subscribe(generation_id)
        try:
            value = prefer_live(durable, current)
            while not await request.is_disconnected():
                signature = (value["status"], value["content"], value["error_code"])
                if signature != previous:
                    yield {"event": "snapshot", "data": json.dumps(value)}
                    previous = signature
                if value["status"] in TERMINAL:
                    return
                try:
                    # Same-process deltas arrive immediately. On another worker,
                    # periodic durable reads still allow reconnect and recovery.
                    latest = await asyncio.wait_for(queue.get(), timeout=0.75)
                    value = latest.payload()
                except TimeoutError:
                    saved = await asyncio.to_thread(
                        _read_generation, profile.id, conversation_id, generation_id
                    )
                    if saved is None:
                        return
                    value = prefer_live(saved, live_hub.current(generation_id))
        finally:
            live_hub.unsubscribe(generation_id, queue)

    return EventSourceResponse(
        events(),
        ping=15,
        headers={"Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no"},
    )
