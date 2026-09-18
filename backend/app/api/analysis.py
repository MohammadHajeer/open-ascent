from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Header, HTTPException, Request, status

from app.api.dependencies.analysis_access import GuestAnalysisAccess
from app.core.config import settings
from app.core.guest_rate_limit import build_guest_rate_key
from app.db.database import DbSession
from app.schemas.analysis import (
    GuestAnalysisReservationRequest,
    GuestAnalysisReservationResponse,
    GuestAnalysisStatusResponse,
)
from app.services.analysis import (
    AnalysisNotSupportedError,
    IdempotencyConflictError,
    MovementNotFoundError,
    ReservationExpiredError,
    SafetyAcknowledgementOutdatedError,
    SafetyDocumentationMismatchError,
    SafetyDocumentationNotFoundError,
    SafetyDocumentationNotPublishedError,
    reserve_guest_analysis,
)

router = APIRouter(
    prefix="/analyses",
    tags=["Analysis"],
)


IdempotencyKey = Annotated[
    uuid.UUID,
    Header(alias="Idempotency-Key"),
]


@router.post(
    "/guest",
    response_model=GuestAnalysisReservationResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_guest_analysis_reservation(
    payload: GuestAnalysisReservationRequest,
    request: Request,
    db: DbSession,
    idempotency_key: IdempotencyKey,
) -> GuestAnalysisReservationResponse:
    if request.client is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Unable to determine client network.",
        )

    guest_rate_key = build_guest_rate_key(
        request.client.host,
        settings.guest_token_secret,
    )

    try:
        analysis, credential = reserve_guest_analysis(
            db,
            payload,
            operation_key=str(idempotency_key),
            guest_rate_key=guest_rate_key,
        )

    except MovementNotFoundError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Movement not found.",
        )

    except AnalysisNotSupportedError:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Uploaded analysis is not supported for this movement.",
        )

    except SafetyDocumentationNotFoundError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Safety documentation not found.",
        )

    except (
        SafetyDocumentationMismatchError,
        SafetyDocumentationNotPublishedError,
    ):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Safety documentation is not valid for this movement.",
        )

    except SafetyAcknowledgementOutdatedError:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Safety acknowledgement is outdated.",
        )

    except IdempotencyConflictError:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Idempotency key was already used for a different request.",
        )

    except ReservationExpiredError:
        raise HTTPException(
            status_code=status.HTTP_410_GONE,
            detail="The existing reservation is no longer available.",
        )

    return GuestAnalysisReservationResponse(
        analysis_id=analysis.id,
        credential=credential,
        status="reserved",
        reservation_expires_at=analysis.reservation_expires_at,
        access_expires_at=analysis.access_expires_at,
    )


@router.get(
    "/{analysis_id}/status",
    response_model=GuestAnalysisStatusResponse,
)
def get_guest_analysis_status(
    analysis_id: uuid.UUID,
    analysis: GuestAnalysisAccess,
) -> GuestAnalysisStatusResponse:
    return GuestAnalysisStatusResponse(
        analysis_id=analysis.id,
        status=analysis.status,
        stage=analysis.stage,
    )
