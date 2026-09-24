from typing import Literal

from pydantic import BaseModel


class SubscriptionStatusResponse(BaseModel):
    effective_plan: Literal["free", "pro"]


class LiveCoachAccessResponse(BaseModel):
    allowed: bool


class CheckoutSessionResponse(BaseModel):
    url: str
