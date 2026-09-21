from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status

from app.api.dependencies.auth import CurrentUserId
from app.core.config import settings
from app.db.database import DbSession
from app.schemas.subscription import CheckoutSessionResponse, SubscriptionStatusResponse
from app.services.entitlements import resolve_effective_plan
from app.services.stripe_checkout import (
    CheckoutConfigurationError,
    CheckoutNotEligibleError,
    CheckoutProviderError,
    StripeGateway,
    StripeTestGateway,
    create_pro_test_checkout,
)

router = APIRouter(prefix="/subscriptions", tags=["subscriptions"])


def get_stripe_gateway() -> StripeGateway:
    return StripeTestGateway(settings.stripe_secret_key)


@router.get("/me", response_model=SubscriptionStatusResponse)
def get_subscription_status(
    user_id: CurrentUserId,
    db: DbSession,
) -> SubscriptionStatusResponse:
    return SubscriptionStatusResponse(
        effective_plan=resolve_effective_plan(db, user_id).value
    )


@router.post("/checkout", response_model=CheckoutSessionResponse)
def begin_pro_checkout(
    user_id: CurrentUserId,
    db: DbSession,
    gateway: Annotated[StripeGateway, Depends(get_stripe_gateway)],
) -> CheckoutSessionResponse:
    try:
        checkout = create_pro_test_checkout(
            db,
            user_id=user_id,
            settings=settings,
            gateway=gateway,
        )
    except CheckoutNotEligibleError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    except CheckoutConfigurationError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Pro Checkout is not configured for test mode.",
        ) from exc
    except CheckoutProviderError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Checkout is temporarily unavailable. Please try again.",
        ) from exc
    return CheckoutSessionResponse(url=checkout.url)
