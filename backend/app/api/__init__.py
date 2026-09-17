from app.api.movement_documentation import router as movement_documentation_router
from app.api.sse_smoke import router as sse_smoke_router
from app.api.stripe_smoke import router as stripe_smoke_router
from fastapi import APIRouter

api_router = APIRouter()

api_router.include_router(movement_documentation_router)
api_router.include_router(sse_smoke_router)
api_router.include_router(stripe_smoke_router)
