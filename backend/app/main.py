from fastapi import FastAPI
from sqlalchemy import text

from app.db.database import DbSession

app = FastAPI(title="Open Ascent API")


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
