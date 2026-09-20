from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Header, HTTPException, Request, status

from app.api.dependencies.analysis_access import GuestAnalysisAccess
from app.core.config import settings
from app.core.guest_rate_limit import build_guest_rate_key
from app.core.safety import CURRENT_SAFETY_ACK_VERSION
from app.db.database import DbSession
from app.models.movement import Movement
from app.models.movement_documentation import MovementDocumentation
from app.schemas.analysis import (
    DeterministicAnalysisRead,
    GuestAnalysisConfigResponse,
    GuestAnalysisFinalizeResponse,
    GuestAnalysisMovementRead,
    GuestAnalysisReservationRequest,
    GuestAnalysisReservationResponse,
    GuestAnalysisResultResponse,
    GuestAnalysisStatusResponse,
    GuestAnalysisUploadAuthorizationResponse,
    GuestExplanationRetryResponse,
)
from app.schemas.analysis_explanation import AnalysisExplanation
from app.schemas.movement_safety import MovementSafetyContentDraft
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
from app.services.analysis_storage import (
    AnalysisNotReservedError,
    InvalidUploadedVideoError,
    UploadedVideoNotFoundError,
    UploadedVideoTooLargeError,
    UploadedVideoTooLongError,
    UploadReservationExpiredError,
    create_guest_upload_authorization,
    finalize_guest_analysis_upload,
)
from app.services.explanation_jobs import (
    MAX_EXPLANATION_ATTEMPTS,
    ExplanationRetryUnavailableError,
    retry_failed_explanation,
)

router = APIRouter(
    prefix="/analyses",
    tags=["Analysis"],
)


IdempotencyKey = Annotated[
    uuid.UUID,
    Header(alias="Idempotency-Key"),
]


@router.get("/guest/config", response_model=GuestAnalysisConfigResponse)
def get_guest_analysis_config() -> GuestAnalysisConfigResponse:
    return GuestAnalysisConfigResponse(
        allowed_content_types=["video/mp4"],
        max_size_bytes=settings.guest_video_max_size_mb * 1024 * 1024,
        max_duration_seconds=settings.guest_video_max_duration_seconds,
        safety_ack_version=CURRENT_SAFETY_ACK_VERSION,
    )


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


@router.post(
    "/{analysis_id}/upload",
    response_model=GuestAnalysisUploadAuthorizationResponse,
)
def create_guest_analysis_upload(
    analysis_id: uuid.UUID,
    analysis: GuestAnalysisAccess,
) -> GuestAnalysisUploadAuthorizationResponse:
    try:
        path, token = create_guest_upload_authorization(analysis)

    except AnalysisNotReservedError:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Analysis is not awaiting an upload.",
        )

    except UploadReservationExpiredError:
        raise HTTPException(
            status_code=status.HTTP_410_GONE,
            detail="Analysis reservation has expired.",
        )

    return GuestAnalysisUploadAuthorizationResponse(
        analysis_id=analysis.id,
        bucket=settings.supabase_video_bucket,
        path=path,
        token=token,
        max_size_bytes=(settings.guest_video_max_size_mb * 1024 * 1024),
        allowed_content_types=[
            "video/mp4",
        ],
    )


@router.post(
    "/{analysis_id}/finalize",
    response_model=GuestAnalysisFinalizeResponse,
)
def finalize_guest_analysis(
    analysis_id: uuid.UUID,
    analysis: GuestAnalysisAccess,
    db: DbSession,
) -> GuestAnalysisFinalizeResponse:
    try:
        finalized = finalize_guest_analysis_upload(
            db,
            analysis_id=analysis.id,
        )

    except UploadedVideoNotFoundError:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Uploaded video was not found.",
        )

    except UploadedVideoTooLargeError:
        raise HTTPException(
            status_code=status.HTTP_413_CONTENT_TOO_LARGE,
            detail="Uploaded video exceeds the allowed size.",
        )

    except InvalidUploadedVideoError:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail="Uploaded file is not a valid supported video.",
        )

    except UploadedVideoTooLongError:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Uploaded video exceeds the allowed duration.",
        )

    except UploadReservationExpiredError:
        raise HTTPException(
            status_code=status.HTTP_410_GONE,
            detail="Analysis reservation has expired.",
        )

    except AnalysisNotReservedError:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Analysis cannot be finalized.",
        )

    return GuestAnalysisFinalizeResponse(
        analysis_id=finalized.id,
        video_path=finalized.video_path,
        status="queued",
        stage="queued",
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


@router.get(
    "/{analysis_id}/result",
    response_model=GuestAnalysisResultResponse,
)
def get_guest_analysis_result(
    analysis_id: uuid.UUID,
    analysis: GuestAnalysisAccess,
    db: DbSession,
) -> GuestAnalysisResultResponse:
    movement = db.get(Movement, analysis.movement_id)
    documentation = db.get(MovementDocumentation, analysis.safety_documentation_id)
    if movement is None or documentation is None:
        raise HTTPException(status_code=404, detail="Analysis guide not found.")

    result = None
    if analysis.status == "completed" and analysis.result is not None:
        result = DeterministicAnalysisRead.model_validate(analysis.result)

    explanation = None
    if (
        result is not None
        and analysis.ai_feedback_status == "completed"
        and analysis.ai_explanation is not None
    ):
        explanation = AnalysisExplanation.model_validate(analysis.ai_explanation)

    return GuestAnalysisResultResponse(
        analysis_id=analysis.id,
        status=analysis.status,
        stage=analysis.stage,
        movement=GuestAnalysisMovementRead(
            id=movement.id,
            slug=movement.slug,
            name=movement.name,
            safety=MovementSafetyContentDraft.model_validate(documentation.content),
        ),
        result=result,
        explanation_status=analysis.ai_feedback_status,
        explanation=explanation,
        explanation_retry_available=(
            result is not None
            and analysis.ai_feedback_status == "failed"
            and analysis.ai_feedback_attempts < MAX_EXPLANATION_ATTEMPTS
        ),
    )


@router.post(
    "/{analysis_id}/explanation/retry",
    response_model=GuestExplanationRetryResponse,
)
def retry_guest_analysis_explanation(
    analysis_id: uuid.UUID,
    analysis: GuestAnalysisAccess,
    db: DbSession,
) -> GuestExplanationRetryResponse:
    try:
        explanation_status = retry_failed_explanation(db, analysis.id)
    except ExplanationRetryUnavailableError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=str(exc),
        ) from exc
    return GuestExplanationRetryResponse(explanation_status=explanation_status)
