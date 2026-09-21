from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.exc import IntegrityError

from app.core.config import settings
from app.db.database import DbSession
from app.models.subscription import StripeWebhookEvent
from app.services.stripe_webhooks import (
    InvalidWebhookError,
    StripeSubscriptionGateway,
    StripeTestSubscriptionGateway,
    WebhookConfigurationError,
    WebhookProviderError,
    construct_verified_test_event,
    reconcile_verified_event,
)

router = APIRouter(tags=["subscriptions"])


def get_stripe_subscription_gateway() -> StripeSubscriptionGateway:
    return StripeTestSubscriptionGateway(settings.stripe_secret_key)


@router.post("/webhooks/stripe")
async def receive_stripe_webhook(
    request: Request,
    db: DbSession,
    gateway: Annotated[
        StripeSubscriptionGateway, Depends(get_stripe_subscription_gateway)
    ],
):
    signature = request.headers.get("Stripe-Signature")
    if not signature:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid Stripe webhook.",
        )

    # Stripe signatures cover the exact request bytes. Do not call request.json()
    # or otherwise normalize the payload before verification.
    payload = await request.body()
    event = None
    try:
        event = construct_verified_test_event(payload, signature, settings=settings)
        result = reconcile_verified_event(
            db,
            event,
            settings=settings,
            gateway=gateway,
        )
        db.commit()
    except WebhookConfigurationError as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Stripe test webhooks are not configured.",
        ) from exc
    except InvalidWebhookError as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid Stripe webhook.",
        ) from exc
    except WebhookProviderError as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Stripe subscription verification is temporarily unavailable.",
        ) from exc
    except IntegrityError as exc:
        db.rollback()
        event_id = getattr(event, "id", None) if event is not None else None
        if isinstance(event_id, str) and db.get(StripeWebhookEvent, event_id) is not None:
            return {"received": True, "outcome": "duplicate"}
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Stripe webhook reconciliation failed.",
        ) from exc
    except Exception:
        db.rollback()
        raise

    return {"received": True, "outcome": result.outcome}
