from collections.abc import Generator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.db.database import engine, get_db
from app.main import app
from app.services import analysis as analysis_service


def pytest_configure(config: pytest.Config) -> None:
    config.addinivalue_line(
        "markers",
        "real_worker_health: use real worker heartbeats for analysis admission",
    )


@pytest.fixture(autouse=True)
def analysis_worker_available(
    request: pytest.FixtureRequest, monkeypatch: pytest.MonkeyPatch
) -> None:
    # The suite shares a live database whose worker heartbeats depend on
    # whether a developer worker happens to be running. Reservation tests
    # therefore assume a healthy worker unless they opt into the real check.
    if request.node.get_closest_marker("real_worker_health") is None:
        monkeypatch.setattr(
            analysis_service, "require_analysis_service_available", lambda db: None
        )


@pytest.fixture
def db() -> Generator[Session, None, None]:
    connection = engine.connect()
    transaction = connection.begin()

    session = Session(
        bind=connection,
        join_transaction_mode="create_savepoint",
        expire_on_commit=False,
    )

    try:
        yield session
    finally:
        session.close()
        transaction.rollback()
        connection.close()


@pytest.fixture
def client(
    db: Session,
) -> Generator[TestClient, None, None]:
    def override_get_db():
        yield db

    app.dependency_overrides[get_db] = override_get_db

    with TestClient(
        app,
        client=("127.0.0.1", 50000),
    ) as test_client:
        yield test_client

    app.dependency_overrides.pop(get_db, None)
