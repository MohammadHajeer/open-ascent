from __future__ import annotations

import hashlib
import json
from datetime import UTC, datetime, timedelta

from sqlalchemy import func, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.guest_credentials import (
    derive_guest_token,
    hash_guest_token,
)
from app.core.safety import CURRENT_SAFETY_ACK_VERSION
from app.models.analysis import Analysis
from app.models.movement import Movement
from app.models.movement_documentation import MovementDocumentation
from app.schemas.analysis import GuestAnalysisReservationRequest

# ---------------------------------------------------------------------------
# Exceptions
# ---------------------------------------------------------------------------


class IdempotencyConflictError(Exception):
    pass


class ReservationExpiredError(Exception):
    pass


class GuestRateLimitExceededError(Exception):
    pass


class MovementNotFoundError(Exception):
    pass


class AnalysisNotSupportedError(Exception):
    pass


class SafetyDocumentationNotFoundError(Exception):
    pass


class SafetyDocumentationNotPublishedError(Exception):
    pass


class SafetyDocumentationMismatchError(Exception):
    pass


class SafetyAcknowledgementOutdatedError(Exception):
    pass


# ---------------------------------------------------------------------------
# Request helpers
# ---------------------------------------------------------------------------


def build_request_fingerprint(
    payload: GuestAnalysisReservationRequest,
) -> str:
    data = {
        "movement_id": str(payload.movement_id),
        "safety_documentation_id": str(payload.safety_documentation_id),
        "safety_ack_version": payload.safety_ack_version,
    }
    if payload.family_key is not None:
        data["family_key"] = payload.family_key

    serialized = json.dumps(
        data,
        sort_keys=True,
        separators=(",", ":"),
    )

    return hashlib.sha256(serialized.encode("utf-8")).hexdigest()


def _build_credential(
    operation_key: str,
    request_fingerprint: str,
) -> tuple[str, str]:
    credential = derive_guest_token(
        operation_key=operation_key,
        request_fingerprint=request_fingerprint,
        secret=settings.guest_token_secret,
    )

    credential_hash = hash_guest_token(
        credential,
        settings.guest_token_secret,
    )

    return credential, credential_hash


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------


def _get_valid_movement(
    db: Session,
    movement_id,
) -> Movement:
    movement = db.scalar(select(Movement).where(Movement.id == movement_id))

    if movement is None:
        raise MovementNotFoundError

    if not movement.upload_analysis_supported:
        raise AnalysisNotSupportedError

    return movement


def _get_valid_safety_documentation(
    db: Session,
    *,
    documentation_id,
    movement_id,
) -> MovementDocumentation:
    documentation = db.scalar(
        select(MovementDocumentation).where(
            MovementDocumentation.id == documentation_id
        )
    )

    if documentation is None:
        raise SafetyDocumentationNotFoundError

    if documentation.movement_id != movement_id:
        raise SafetyDocumentationMismatchError

    if documentation.status != "published":
        raise SafetyDocumentationNotPublishedError

    return documentation


def _validate_safety_acknowledgement(
    safety_ack_version: str,
) -> None:
    if safety_ack_version != CURRENT_SAFETY_ACK_VERSION:
        raise SafetyAcknowledgementOutdatedError


def _validate_existing_reservation(
    analysis: Analysis,
    *,
    request_fingerprint: str,
    now: datetime,
) -> None:
    if analysis.request_fingerprint != request_fingerprint:
        raise IdempotencyConflictError

    if (
        analysis.owner_kind != "guest"
        or analysis.status != "reserved"
        or analysis.reservation_expires_at <= now
    ):
        raise ReservationExpiredError


# ---------------------------------------------------------------------------
# Idempotency
# ---------------------------------------------------------------------------


def _handle_existing_reservation(
    db: Session,
    *,
    operation_key: str,
    request_fingerprint: str,
    now: datetime,
) -> tuple[Analysis, str] | None:
    existing_analysis = db.scalar(
        select(Analysis)
        .where(Analysis.reservation_operation_key == operation_key)
        .with_for_update()
    )

    if existing_analysis is None:
        return None

    _validate_existing_reservation(
        existing_analysis,
        request_fingerprint=request_fingerprint,
        now=now,
    )

    credential, credential_hash = _build_credential(
        operation_key,
        request_fingerprint,
    )

    # Compatibility for reservations created before deterministic
    # guest credentials were introduced.
    #
    # For normal new reservations this will already match, so an
    # idempotent retry does not mutate anything.
    if existing_analysis.guest_token_hash != credential_hash:
        existing_analysis.guest_token_hash = credential_hash

        db.commit()
        db.refresh(existing_analysis)

    return existing_analysis, credential


# ---------------------------------------------------------------------------
# Guest reservation
# ---------------------------------------------------------------------------


def reserve_guest_analysis(
    db: Session,
    payload: GuestAnalysisReservationRequest,
    *,
    operation_key: str,
    guest_rate_key: str,
) -> tuple[Analysis, str]:
    now = datetime.now(UTC)

    request_fingerprint = build_request_fingerprint(payload)

    # ---------------------------------------------------------
    # 1. Idempotent retry
    # ---------------------------------------------------------

    existing_reservation = _handle_existing_reservation(
        db,
        operation_key=operation_key,
        request_fingerprint=request_fingerprint,
        now=now,
    )

    if existing_reservation is not None:
        return existing_reservation

    # Serialize reservations from the same signed network prefix. The key is
    # already an HMAC, so neither the prefix nor the original IP is stored.
    lock_key = int.from_bytes(bytes.fromhex(guest_rate_key[:16]), "big", signed=True)
    db.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": lock_key})
    # A concurrent request with the same operation may have committed while
    # waiting for the lock.
    existing_reservation = _handle_existing_reservation(
        db, operation_key=operation_key,
        request_fingerprint=request_fingerprint, now=now,
    )
    if existing_reservation is not None:
        return existing_reservation
    recent_count = db.scalar(
        select(func.count(Analysis.id)).where(
            Analysis.owner_kind == "guest",
            Analysis.guest_rate_key == guest_rate_key,
            Analysis.created_at >= now - timedelta(minutes=settings.guest_rate_window_minutes),
        )
    )
    if recent_count >= settings.guest_reservations_per_window:
        db.rollback()
        raise GuestRateLimitExceededError

    # ---------------------------------------------------------
    # 2. Movement validation
    # ---------------------------------------------------------

    if payload.family_mode:
        movement = None
        # Reuse the published baseline vertical-pull guidance. The selected
        # intention remains family-only and is never stored as Pull-Up.
        safety_movement = db.scalar(select(Movement).where(Movement.slug == "pull-up"))
        if safety_movement is None or safety_movement.family_key != "vertical_pull":
            raise AnalysisNotSupportedError
    elif payload.movement_id is not None and payload.family_key is None:
        movement = _get_valid_movement(db, payload.movement_id)
        safety_movement = movement
    else:
        raise AnalysisNotSupportedError

    # ---------------------------------------------------------
    # 3. Safety documentation validation
    # ---------------------------------------------------------

    documentation = _get_valid_safety_documentation(
        db,
        documentation_id=(payload.safety_documentation_id),
        movement_id=safety_movement.id,
    )

    # ---------------------------------------------------------
    # 4. Global safety acknowledgement
    # ---------------------------------------------------------

    _validate_safety_acknowledgement(payload.safety_ack_version)

    # ---------------------------------------------------------
    # 5. Deterministic guest credential
    # ---------------------------------------------------------

    credential, credential_hash = _build_credential(
        operation_key,
        request_fingerprint,
    )

    # ---------------------------------------------------------
    # 6. Expiration / retention times
    # ---------------------------------------------------------

    reservation_expires_at = now + timedelta(
        minutes=(settings.guest_reservation_ttl_minutes)
    )

    access_expires_at = now + timedelta(minutes=(settings.guest_access_ttl_minutes))

    purge_after = now + timedelta(hours=settings.guest_purge_ttl_hours)

    # ---------------------------------------------------------
    # 7. Create reserved analysis
    # ---------------------------------------------------------

    analysis = Analysis(
        movement_id=movement.id if movement is not None else None,
        family_key=safety_movement.family_key,
        safety_documentation_id=documentation.id,
        safety_ack_version=(CURRENT_SAFETY_ACK_VERSION),
        safety_acknowledged_at=now,
        owner_kind="guest",
        status="reserved",
        stage="reserved",
        guest_token_hash=credential_hash,
        guest_rate_key=guest_rate_key,
        reservation_operation_key=operation_key,
        request_fingerprint=request_fingerprint,
        reservation_expires_at=(reservation_expires_at),
        access_expires_at=access_expires_at,
        purge_after=purge_after,
    )

    db.add(analysis)

    # ---------------------------------------------------------
    # 8. Handle simultaneous requests using the same
    #    idempotency key
    # ---------------------------------------------------------

    try:
        db.commit()

    except IntegrityError:
        db.rollback()

        existing_analysis = db.scalar(
            select(Analysis)
            .where(Analysis.reservation_operation_key == operation_key)
            .with_for_update()
        )

        # The IntegrityError came from something unrelated
        # to the idempotency key.
        if existing_analysis is None:
            raise

        _validate_existing_reservation(
            existing_analysis,
            request_fingerprint=request_fingerprint,
            now=now,
        )

        # Same operation key + same request always produces
        # the same credential.
        existing_credential, credential_hash = _build_credential(
            operation_key,
            request_fingerprint,
        )

        # Compatibility safeguard for older development rows.
        if existing_analysis.guest_token_hash != credential_hash:
            existing_analysis.guest_token_hash = credential_hash

            db.commit()
            db.refresh(existing_analysis)

        return (
            existing_analysis,
            existing_credential,
        )

    db.refresh(analysis)

    return analysis, credential
