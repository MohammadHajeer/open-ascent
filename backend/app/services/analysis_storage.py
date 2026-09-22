from __future__ import annotations

import tempfile
import uuid
from datetime import UTC, datetime
from pathlib import Path

import cv2
from sqlalchemy import select
from sqlalchemy.orm import Session
from storage3.exceptions import StorageApiError

from app.core.config import settings
from app.core.supabase import supabase
from app.models.analysis import Analysis
from app.services.analysis_events import record_analysis_event


class AnalysisNotReservedError(Exception):
    pass


class UploadReservationExpiredError(Exception):
    pass


class UploadedVideoNotFoundError(Exception):
    pass


class UploadedVideoTooLargeError(Exception):
    pass


class InvalidUploadedVideoError(Exception):
    pass


class UploadedVideoTooLongError(Exception):
    pass


def uploaded_video_suffix(video_bytes: bytes) -> str:
    if len(video_bytes) >= 12 and video_bytes[4:8] == b"ftyp":
        return ".mp4"
    if video_bytes.startswith(b"\x1a\x45\xdf\xa3"):
        return ".webm"
    raise InvalidUploadedVideoError


def build_analysis_video_path(
    analysis_id: uuid.UUID,
) -> str:
    return f"analyses/{analysis_id}/source.mp4"


def create_analysis_upload_authorization(
    analysis: Analysis,
) -> tuple[str, str]:
    now = datetime.now(UTC)

    if analysis.status != "reserved":
        raise AnalysisNotReservedError

    if analysis.reservation_expires_at <= now:
        raise UploadReservationExpiredError

    path = build_analysis_video_path(analysis.id)

    response = supabase.storage.from_(
        settings.supabase_video_bucket
    ).create_signed_upload_url(path)

    return path, response["token"]


def analysis_video_limits(analysis: Analysis) -> tuple[int, int]:
    if analysis.owner_kind == "guest":
        return (
            settings.guest_video_max_size_mb * 1024 * 1024,
            settings.guest_video_max_duration_seconds,
        )
    return (
        settings.authenticated_video_max_size_mb * 1024 * 1024,
        settings.authenticated_video_max_duration_seconds,
    )


def _download_uploaded_video(
    path: str,
) -> bytes:
    try:
        return supabase.storage.from_(settings.supabase_video_bucket).download(path)
    except StorageApiError as exc:
        raise UploadedVideoNotFoundError from exc


def _validate_video_bytes(
    video_bytes: bytes,
    *,
    max_size_bytes: int,
    max_duration_seconds: int,
) -> None:
    if not video_bytes:
        raise InvalidUploadedVideoError

    if len(video_bytes) > max_size_bytes:
        raise UploadedVideoTooLargeError

    suffix = uploaded_video_suffix(video_bytes)

    temp_path: Path | None = None

    try:
        with tempfile.NamedTemporaryFile(
            suffix=suffix,
            delete=False,
        ) as temp_file:
            temp_file.write(video_bytes)
            temp_path = Path(temp_file.name)

        capture = cv2.VideoCapture(str(temp_path))

        try:
            if not capture.isOpened():
                raise InvalidUploadedVideoError

            fps = capture.get(cv2.CAP_PROP_FPS)
            frame_count = capture.get(cv2.CAP_PROP_FRAME_COUNT)
            width = capture.get(cv2.CAP_PROP_FRAME_WIDTH)
            height = capture.get(cv2.CAP_PROP_FRAME_HEIGHT)

            success, _ = capture.read()

            if not success or fps <= 0 or frame_count <= 0 or width <= 0 or height <= 0:
                raise InvalidUploadedVideoError

            duration_seconds = frame_count / fps

            if duration_seconds > max_duration_seconds:
                raise UploadedVideoTooLongError

        finally:
            capture.release()

    finally:
        if temp_path is not None:
            temp_path.unlink(missing_ok=True)


def finalize_analysis_upload(
    db: Session,
    *,
    analysis_id: uuid.UUID,
) -> Analysis:
    expected_path = build_analysis_video_path(analysis_id)

    analysis = db.scalar(select(Analysis).where(Analysis.id == analysis_id))

    if analysis is None:
        raise AnalysisNotReservedError

    # Already finalized = idempotent success.
    if analysis.video_path == expected_path and analysis.status != "reserved":
        return analysis

    if analysis.status != "reserved":
        raise AnalysisNotReservedError

    if analysis.reservation_expires_at <= datetime.now(UTC):
        raise UploadReservationExpiredError

    video_bytes = _download_uploaded_video(expected_path)

    max_size_bytes, max_duration_seconds = analysis_video_limits(analysis)
    _validate_video_bytes(
        video_bytes,
        max_size_bytes=max_size_bytes,
        max_duration_seconds=max_duration_seconds,
    )

    # Lock only for the final state transition.
    analysis = db.scalar(
        select(Analysis).where(Analysis.id == analysis_id).with_for_update()
    )

    if analysis is None:
        raise AnalysisNotReservedError

    # Another finalize request may have won the race.
    if analysis.video_path == expected_path and analysis.status != "reserved":
        return analysis

    if analysis.status != "reserved":
        raise AnalysisNotReservedError

    if analysis.reservation_expires_at <= datetime.now(UTC):
        raise UploadReservationExpiredError

    analysis.video_path = expected_path
    analysis.status = "queued"
    analysis.stage = "queued"
    record_analysis_event(
        db,
        analysis_id=analysis.id,
        attempt=0,
        event_type="analysis_queued",
    )

    db.commit()
    db.refresh(analysis)

    return analysis


# Compatibility aliases for callers outside the API module.
create_guest_upload_authorization = create_analysis_upload_authorization
finalize_guest_analysis_upload = finalize_analysis_upload
