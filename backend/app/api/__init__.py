from fastapi import APIRouter

from app.api.analysis import router as analysis_router
from app.api.analysis_stream import router as analysis_stream_router
from app.api.movement_documentation import router as movement_documentation_router
from app.api.movements import router as movements_router
from app.api.onboarding import router as onboarding_router
from app.api.sse_smoke import router as sse_smoke_router
from app.api.stripe_smoke import router as stripe_smoke_router

api_router = APIRouter()

api_router.include_router(movements_router)
api_router.include_router(onboarding_router)
api_router.include_router(movement_documentation_router)
api_router.include_router(sse_smoke_router)
api_router.include_router(stripe_smoke_router)
api_router.include_router(analysis_router)
api_router.include_router(analysis_stream_router)
