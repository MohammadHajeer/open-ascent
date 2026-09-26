from fastapi import FastAPI, Request
from fastapi.exceptions import HTTPException, RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text

from app.api import api_router
from app.core.config import settings
from app.db.database import DbSession

app = FastAPI(title="Open Ascent API")
app.include_router(api_router)


app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(HTTPException)
async def http_exception_handler(
    request: Request,
    exc: HTTPException,
):
    # A structured detail carries a stable machine-readable code so clients
    # never parse message text.
    if isinstance(exc.detail, dict) and "code" in exc.detail:
        error = {
            "code": str(exc.detail["code"]),
            "message": str(exc.detail.get("message", "")),
        }
        if "details" in exc.detail:
            error["details"] = exc.detail["details"]
    else:
        error = {"code": "http_error", "message": str(exc.detail)}
    return JSONResponse(status_code=exc.status_code, content={"error": error})


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(
    request: Request,
    exc: RequestValidationError,
):
    details = []
    for error in exc.errors():
        sanitized = dict(error)
        if "ctx" in sanitized:
            sanitized["ctx"] = {
                key: str(value) for key, value in sanitized["ctx"].items()
            }
        details.append(sanitized)
    return JSONResponse(
        status_code=422,
        content={
            "error": {
                "code": "validation_error",
                "message": "Invalid request",
                "details": details,
            }
        },
    )


@app.get("/health")
def health_check():
    return {"status": "ok"}


@app.get("/health/db")
def database_health_check(db: DbSession):
    db.execute(text("SELECT 1"))

    return {
        "status": "ok",
        "database": "connected",
    }


@app.get("/api/test")
def test_api():
    return {
        "status": "ok",
        "message": "Open Ascent frontend connected to FastAPI",
    }


@app.get("/api/test-error")
def test_error():
    raise HTTPException(
        status_code=400,
        detail="This is a test API error",
    )
