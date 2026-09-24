from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response, status

from app.api.dependencies.auth import AthleteProfile, CurrentUserId
from app.core.config import settings
from app.db.database import DbSession
from app.models.enums import FeatureKey
from app.schemas.subscription import (
    CheckoutSessionResponse,
    LiveCoachAccessResponse,
    SubscriptionStatusResponse,
)
from app.services.entitlements import is_feature_enabled
from app.services.stripe_billing import (
    BillingConfigurationError,
    BillingNotEligibleError,
    BillingProviderError,
    StripeBillingGateway,
    StripeTestBillingGateway,
    cancel_subscription_at_period_end,
    configured_pro_price,
    resume_subscription,
    subscription_overview,
)
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


def get_billing_gateway() -> StripeBillingGateway:
    return StripeTestBillingGateway(settings.stripe_secret_key)


@router.get("/pro-price")
def get_pro_price(
    db: DbSession,
    gateway: Annotated[StripeBillingGateway, Depends(get_billing_gateway)],
    response: Response,
) -> dict:
    response.headers["Cache-Control"] = "no-store"
    try:
        return configured_pro_price(db, settings, gateway)
    except BillingConfigurationError as exc:
        raise HTTPException(status_code=503, detail="Pro pricing is unavailable.") from exc
    except BillingProviderError as exc:
        raise HTTPException(status_code=502, detail="Pro pricing is temporarily unavailable.") from exc


@router.get("/me", response_model=SubscriptionStatusResponse)
def get_subscription_status(
    user_id: CurrentUserId,
    db: DbSession,
    gateway: Annotated[StripeBillingGateway, Depends(get_billing_gateway)],
    response: Response,
) -> SubscriptionStatusResponse:
    response.headers["Cache-Control"] = "no-store"
    try:
        return SubscriptionStatusResponse.model_validate(
            subscription_overview(db, user_id=user_id, settings=settings, gateway=gateway)
        )
    except BillingConfigurationError as exc:
        raise HTTPException(status_code=503, detail="Test billing is not configured.") from exc
    except BillingProviderError as exc:
        raise HTTPException(status_code=502, detail="Billing information is temporarily unavailable.") from exc


@router.post("/cancel", response_model=SubscriptionStatusResponse)
def cancel_pro_subscription(
    user_id: CurrentUserId,
    db: DbSession,
    gateway: Annotated[StripeBillingGateway, Depends(get_billing_gateway)],
    response: Response,
) -> SubscriptionStatusResponse:
    response.headers["Cache-Control"] = "no-store"
    try:
        cancel_subscription_at_period_end(
            db, user_id=user_id, settings=settings, gateway=gateway
        )
        return SubscriptionStatusResponse.model_validate(
            subscription_overview(db, user_id=user_id, settings=settings, gateway=gateway)
        )
    except BillingNotEligibleError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except BillingConfigurationError as exc:
        raise HTTPException(status_code=503, detail="Test billing is not configured.") from exc
    except BillingProviderError as exc:
        raise HTTPException(status_code=502, detail="Subscription billing is temporarily unavailable.") from exc


@router.post("/resume", response_model=SubscriptionStatusResponse)
def resume_pro_subscription(
    user_id: CurrentUserId,
    db: DbSession,
    gateway: Annotated[StripeBillingGateway, Depends(get_billing_gateway)],
    response: Response,
) -> SubscriptionStatusResponse:
    response.headers["Cache-Control"] = "no-store"
    try:
        resume_subscription(db, user_id=user_id, settings=settings, gateway=gateway)
        return SubscriptionStatusResponse.model_validate(
            subscription_overview(db, user_id=user_id, settings=settings, gateway=gateway)
        )
    except BillingNotEligibleError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except BillingConfigurationError as exc:
        raise HTTPException(status_code=503, detail="Test billing is not configured.") from exc
    except BillingProviderError as exc:
        raise HTTPException(status_code=502, detail="Subscription billing is temporarily unavailable.") from exc


@router.get("/live-coach-access", response_model=LiveCoachAccessResponse)
def get_live_coach_access(
    profile: AthleteProfile,
    db: DbSession,
    response: Response,
) -> LiveCoachAccessResponse:
    response.headers["Cache-Control"] = "no-store"
    return LiveCoachAccessResponse(
        allowed=is_feature_enabled(db, profile.id, FeatureKey.LIVE_COACH)
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
