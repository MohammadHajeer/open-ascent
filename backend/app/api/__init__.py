from fastapi import APIRouter

from app.api.admin_management import router as admin_management_router
from app.api.admin_operations import router as admin_operations_router
from app.api.analysis import router as analysis_router
from app.api.analysis_stream import router as analysis_stream_router
from app.api.coach import router as coach_router
from app.api.dashboard import router as dashboard_router
from app.api.dashboard_tour import router as dashboard_tour_router
from app.api.movement_documentation import router as movement_documentation_router
from app.api.movements import router as movements_router
from app.api.onboarding import router as onboarding_router
from app.api.progress import router as progress_router
from app.api.sse_smoke import router as sse_smoke_router
from app.api.stripe_smoke import router as stripe_smoke_router
from app.api.stripe_webhook import router as stripe_webhook_router
from app.api.subscriptions import router as subscriptions_router
from app.api.training_plans import router as training_plans_router
from app.api.workouts import router as workouts_router

api_router = APIRouter()

api_router.include_router(movements_router)
api_router.include_router(admin_operations_router)
api_router.include_router(admin_management_router)
api_router.include_router(onboarding_router)
api_router.include_router(dashboard_tour_router)
api_router.include_router(dashboard_router)
api_router.include_router(progress_router)
api_router.include_router(movement_documentation_router)
api_router.include_router(sse_smoke_router)
api_router.include_router(stripe_smoke_router)
api_router.include_router(stripe_webhook_router)
api_router.include_router(subscriptions_router)
api_router.include_router(analysis_router)
api_router.include_router(analysis_stream_router)
api_router.include_router(coach_router)
api_router.include_router(training_plans_router)
api_router.include_router(workouts_router)
