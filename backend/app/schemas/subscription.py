from datetime import datetime
from typing import Literal

from pydantic import BaseModel


class ProPrice(BaseModel):
    unit_amount: int
    currency: str
    interval: Literal["month"]


class SubscriptionStatusResponse(BaseModel):
    effective_plan: Literal["free", "pro"]
    pro_price: ProPrice
    subscription_status: str | None = None
    cancel_at_period_end: bool = False
    current_period_end: datetime | None = None
    can_cancel: bool = False


class LiveCoachAccessResponse(BaseModel):
    allowed: bool


class CheckoutSessionResponse(BaseModel):
    url: str
