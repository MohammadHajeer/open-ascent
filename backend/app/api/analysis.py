from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Header, HTTPException, Query, Request, status
from sqlalchemy import select

from app.api.dependencies.analysis_access import AnalysisAccess
from app.api.dependencies.auth import AthleteProfile
from app.core.config import settings
from app.core.guest_rate_limit import build_guest_rate_key
from app.core.safety import CURRENT_SAFETY_ACK_VERSION
from app.db.database import DbSession
from app.models.analysis import Analysis
from app.models.movement import Movement
from app.models.movement_documentation import MovementDocumentation
from app.schemas.analysis import (
    AnalysisHistoryItem,
    AnalysisHistoryMovementRead,
    AuthenticatedAnalysisReservationResponse,
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
    GuestDailyLimitExceededError,
    GuestGlobalDailyLimitExceededError,
    GuestRateLimitExceededError,
    IdempotencyConflictError,
    InvalidGuestIdentityCredentialError,
    MovementNotFoundError,
    ReservationExpiredError,
    SafetyAcknowledgementOutdatedError,
    SafetyDocumentationMismatchError,
    SafetyDocumentationNotFoundError,
    SafetyDocumentationNotPublishedError,
    reserve_authenticated_analysis,
    reserve_guest_analysis,
)
from app.services.analysis_storage import (
    AnalysisNotReservedError,
    InvalidUploadedVideoError,
    UploadedVideoNotFoundError,
    UploadedVideoTooLargeError,
    UploadedVideoTooLongError,
    UploadReservationExpiredError,
    analysis_video_limits,
    create_analysis_upload_authorization,
    finalize_analysis_upload,
)
from app.services.entitlements import UnconfiguredAllowanceError
from app.services.explanation_jobs import (
    MAX_EXPLANATION_ATTEMPTS,
    ExplanationRetryUnavailableError,
    retry_failed_explanation,
)
from app.services.feature_usage import FeatureAccessDeniedError, QuotaExceededError

router = APIRouter(
    prefix="/analyses",
    tags=["Analysis"],
)


IdempotencyKey = Annotated[
    uuid.UUID,
    Header(alias="Idempotency-Key"),
]


@router.post(
    "",
    response_model=AuthenticatedAnalysisReservationResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_authenticated_analysis_reservation(
    payload: GuestAnalysisReservationRequest,
    profile: AthleteProfile,
    db: DbSession,
    idempotency_key: IdempotencyKey,
) -> AuthenticatedAnalysisReservationResponse:
    try:
        analysis = reserve_authenticated_analysis(
            db,
            payload,
            operation_key=str(idempotency_key),
            user_id=profile.id,
        )
    except MovementNotFoundError:
        raise HTTPException(status_code=404, detail="Movement not found.")
    except AnalysisNotSupportedError:
        raise HTTPException(
            status_code=409,
            detail="Uploaded analysis is not supported for this movement.",
        )
    except SafetyDocumentationNotFoundError:
        raise HTTPException(status_code=404, detail="Safety documentation not found.")
    except (SafetyDocumentationMismatchError, SafetyDocumentationNotPublishedError):
        raise HTTPException(
            status_code=409,
            detail="Safety documentation is not valid for this movement.",
        )
    except SafetyAcknowledgementOutdatedError:
        raise HTTPException(
            status_code=409, detail="Safety acknowledgement is outdated."
        )
    except IdempotencyConflictError:
        raise HTTPException(
            status_code=409,
            detail="Idempotency key was already used for a different request.",
        )
    except ReservationExpiredError:
        raise HTTPException(
            status_code=410,
            detail="The existing reservation is no longer available.",
        )
    except FeatureAccessDeniedError:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Video analysis is not enabled for the effective plan.",
        )
    except QuotaExceededError:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Video analysis allowance is exhausted for this period.",
        )
    except UnconfiguredAllowanceError:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Video analysis allowance is not configured.",
        )
    return AuthenticatedAnalysisReservationResponse(
        analysis_id=analysis.id,
        reservation_expires_at=analysis.reservation_expires_at,
    )


@router.get("", response_model=list[AnalysisHistoryItem])
def list_authenticated_analysis_history(
    profile: AthleteProfile,
    db: DbSession,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
) -> list[AnalysisHistoryItem]:
    analyses = list(
        db.scalars(
            select(Analysis)
            .where(
                Analysis.owner_kind == "authenticated",
                Analysis.user_id == profile.id,
            )
            .order_by(Analysis.created_at.desc(), Analysis.id.desc())
            .limit(limit)
        )
    )
    movement_ids = {item.movement_id for item in analyses if item.movement_id}
    movements = (
        {
            movement.id: movement
            for movement in db.scalars(
                select(Movement).where(Movement.id.in_(movement_ids))
            )
        }
        if movement_ids
        else {}
    )
    return [
        AnalysisHistoryItem(
            analysis_id=item.id,
            status=item.status,
            stage=item.stage,
            movement=AnalysisHistoryMovementRead(
                id=movement.id
                if (movement := movements.get(item.movement_id))
                else None,
                slug=movement.slug if movement else "any-vertical-pull",
                name=movement.name if movement else "Any Vertical Pull",
            ),
            created_at=item.created_at,
            completed_at=item.completed_at,
            terminal_outcome=item.terminal_outcome,
            valid_rep_count=item.valid_rep_count,
            partial_rep_count=item.partial_rep_count,
            uncertain_rep_count=item.uncertain_rep_count,
            explanation_status=item.ai_feedback_status,
        )
        for item in analyses
    ]


@router.get("/guest/config", response_model=GuestAnalysisConfigResponse)
def get_guest_analysis_config() -> GuestAnalysisConfigResponse:
    return GuestAnalysisConfigResponse(
        allowed_content_types=["video/mp4"],
        max_size_bytes=settings.guest_video_max_size_mb * 1024 * 1024,
        max_duration_seconds=settings.guest_video_max_duration_seconds,
        authenticated_max_size_bytes=(
            settings.authenticated_video_max_size_mb * 1024 * 1024
        ),
        authenticated_max_duration_seconds=(
            settings.authenticated_video_max_duration_seconds
        ),
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
    guest_credential: Annotated[str | None, Header(alias="Guest-Credential")] = None,
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
            guest_identity_credential=guest_credential,
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

    except GuestRateLimitExceededError:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Guest analysis limit reached. Please try again later.",
        )

    except GuestDailyLimitExceededError:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Guests can analyze one video per day. Sign in to continue analyzing.",
        )

    except GuestGlobalDailyLimitExceededError:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Guest analysis capacity has been reached for today. Sign in to continue analyzing.",
        )

    except InvalidGuestIdentityCredentialError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid guest credential.",
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
    analysis: AnalysisAccess,
) -> GuestAnalysisUploadAuthorizationResponse:
    try:
        path, token = create_analysis_upload_authorization(analysis)

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

    max_size_bytes, _ = analysis_video_limits(analysis)
    return GuestAnalysisUploadAuthorizationResponse(
        analysis_id=analysis.id,
        bucket=settings.supabase_video_bucket,
        path=path,
        token=token,
        max_size_bytes=max_size_bytes,
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
    analysis: AnalysisAccess,
    db: DbSession,
) -> GuestAnalysisFinalizeResponse:
    try:
        finalized = finalize_analysis_upload(
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
            detail=(
                "Guest videos can be up to 10 MB."
                if analysis.owner_kind == "guest"
                else "Uploaded video exceeds the allowed size."
            ),
        )

    except InvalidUploadedVideoError:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail="Uploaded file is not a valid supported video.",
        )

    except UploadedVideoTooLongError:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=(
                "Guest videos can be up to 20 seconds."
                if analysis.owner_kind == "guest"
                else "Uploaded video exceeds the allowed duration."
            ),
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
    analysis: AnalysisAccess,
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
    analysis: AnalysisAccess,
    db: DbSession,
) -> GuestAnalysisResultResponse:
    movement = db.get(Movement, analysis.movement_id) if analysis.movement_id else None
    documentation = db.get(MovementDocumentation, analysis.safety_documentation_id)
    if documentation is None or (movement is None and analysis.movement_id is not None):
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
            id=movement.id if movement else None,
            slug=movement.slug if movement else "any-vertical-pull",
            name=movement.name if movement else "Any Vertical Pull",
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
    analysis: AnalysisAccess,
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
