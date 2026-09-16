from __future__ import annotations

from fastapi import APIRouter, Request

router = APIRouter(prefix="/smoke", tags=["smoke"])


@router.post("/stripe-webhook")
async def stripe_webhook_smoke(request: Request) -> dict[str, bool]:
    payload = await request.body()

    print(f"Stripe webhook received: {len(payload)} bytes")

    return {"received": True}