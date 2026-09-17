"""Register all Open Ascent application tables in Base.metadata."""

from app.db.external import auth_users as auth_users
from app.models.ai_run import AIRun
from app.models.analysis import Analysis
from app.models.coach import Conversation, Message
from app.models.movement import Movement
from app.models.movement_documentation import MovementDocumentation
from app.models.profile import Profile
from app.models.subscription import (
    FeatureUsage,
    PlanEntitlement,
    SubscriptionPlan,
    UserSubscription,
)
from app.models.training import TrainingPlan, WorkoutSession, WorkoutSet

__all__ = [
    "AIRun",
    "Analysis",
    "Conversation",
    "FeatureUsage",
    "Message",
    "Movement",
    "MovementDocumentation",
    "PlanEntitlement",
    "Profile",
    "SubscriptionPlan",
    "TrainingPlan",
    "UserSubscription",
    "WorkoutSession",
    "WorkoutSet",
    "auth_users",
]
