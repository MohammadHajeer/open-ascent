"""Conservative visual fallback for unresolved vertical-pull semantics only."""

from __future__ import annotations

import base64
import json
from dataclasses import dataclass, replace
from pathlib import Path
from typing import Annotated, Literal

import cv2
from openai import OpenAI
from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    StringConstraints,
    create_model,
    model_validator,
)

from app.analyzers.common.types import RepAnalysis
from app.core.config import settings

VISUAL_CLASSIFIER_VERSION = "vertical_pull_visual_v1"
SUPPORTED_DIMENSIONS = ("base_movement", "grip_width", "pull_height")
DIMENSION_VALUES: dict[str, tuple[str, ...]] = {
    "base_movement": ("pull_up", "chin_up", "uncertain"),
    "grip_width": ("close", "standard", "wide", "uncertain"),
    "pull_height": ("standard", "high", "uncertain"),
}
FRAME_OFFSETS_MS = (-200, -100, 0, 100, 200)
MAX_FRAME_DIMENSION_PX = 768
JPEG_QUALITY = 82

INSTRUCTIONS = """You are classifying one already-segmented vertical-pull repetition.
The attached frames all belong to the same repetition.
Classify ONLY the requested dimensions.
Do not judge technique quality or decide whether the repetition counts.
Do not infer a category that is not clearly visible.
If the visual evidence is insufficient or borderline, return uncertain.
Return concise visible evidence only; do not provide hidden reasoning."""

DIMENSION_GUIDANCE = {
    "base_movement": (
        "pull_up = pronated-style hand orientation is clearly supported; "
        "chin_up = supinated-style hand orientation is clearly supported; "
        "uncertain = hand orientation cannot be judged reliably."
    ),
    "grip_width": (
        "close = hands clearly narrower than ordinary shoulder-relative pull-up "
        "spacing; standard = ordinary shoulder-relative spacing; wide = clearly "
        "wider than ordinary spacing; uncertain = insufficient or borderline."
    ),
    "pull_height": (
        "standard = normal completed pull-up height; high = the upper torso/chest "
        "rises substantially closer to the hand/bar line than in a normal "
        "chin-over-bar pull-up; uncertain = the frames do not clearly distinguish "
        "standard from high."
    ),
}

EvidenceText = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=1, max_length=160),
]


class _VisualDimensionBase(BaseModel):
    model_config = ConfigDict(extra="forbid")

    confidence: Literal["high", "medium", "low"]
    evidence: list[EvidenceText] = Field(min_length=1, max_length=2)


class BaseMovementVisualClassification(_VisualDimensionBase):
    value: Literal["pull_up", "chin_up", "uncertain"]


class GripWidthVisualClassification(_VisualDimensionBase):
    value: Literal["close", "standard", "wide", "uncertain"]


class PullHeightVisualClassification(_VisualDimensionBase):
    value: Literal["standard", "high", "uncertain"]


DIMENSION_MODELS: dict[str, type[_VisualDimensionBase]] = {
    "base_movement": BaseMovementVisualClassification,
    "grip_width": GripWidthVisualClassification,
    "pull_height": PullHeightVisualClassification,
}


class VisualDimensionResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    value: str
    confidence: Literal["high", "medium", "low"]
    evidence: list[EvidenceText] = Field(min_length=1, max_length=2)


class VisualRepResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    rep_index: int = Field(ge=1)
    classifications: dict[str, VisualDimensionResult]

    @model_validator(mode="after")
    def validate_supported_classifications(self) -> VisualRepResult:
        if not self.classifications:
            raise ValueError("At least one visual classification is required.")
        for dimension, classification in self.classifications.items():
            if dimension not in DIMENSION_VALUES:
                raise ValueError("Unsupported visual classification dimension.")
            if classification.value not in DIMENSION_VALUES[dimension]:
                raise ValueError("Unsupported visual classification value.")
        return self


@dataclass(frozen=True, slots=True)
class VisualClassifierCall:
    result: VisualRepResult
    usage: dict


def unresolved_visual_dimensions(rep: RepAnalysis) -> tuple[str, ...]:
    return tuple(
        dimension
        for dimension in SUPPORTED_DIMENSIONS
        if rep.variations.get(dimension, "uncertain") == "uncertain"
    )


def representative_timestamps_ms(rep: RepAnalysis) -> list[int]:
    start = max(0, rep.start_ms)
    end = max(start, rep.end_ms)
    anchor = rep.top_ms if rep.top_ms is not None else (start + end) // 2
    anchor = min(end, max(start, anchor))
    candidates = {
        min(end, max(start, anchor + offset)) for offset in FRAME_OFFSETS_MS
    }
    if len(candidates) < 3 and end > start:
        duration = end - start
        candidates.update(start + round(duration * fraction) for fraction in (0, 0.25, 0.5, 0.75, 1))
    closest = sorted(candidates, key=lambda value: (abs(value - anchor), value))[:5]
    return sorted(closest)


def extract_representative_frames(
    video_path: Path,
    rep: RepAnalysis,
) -> list[str]:
    """Return 3-5 transient JPEG data URLs; no frame is written to disk."""
    capture = cv2.VideoCapture(str(video_path))
    if not capture.isOpened():
        capture.release()
        raise ValueError("Could not open source video for visual fallback.")

    images: list[str] = []
    try:
        for timestamp_ms in representative_timestamps_ms(rep):
            capture.set(cv2.CAP_PROP_POS_MSEC, timestamp_ms)
            ok, frame = capture.read()
            if not ok or frame is None:
                continue
            height, width = frame.shape[:2]
            largest = max(height, width)
            if largest > MAX_FRAME_DIMENSION_PX:
                scale = MAX_FRAME_DIMENSION_PX / largest
                frame = cv2.resize(
                    frame,
                    (max(1, round(width * scale)), max(1, round(height * scale))),
                    interpolation=cv2.INTER_AREA,
                )
            encoded_ok, encoded = cv2.imencode(
                ".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, JPEG_QUALITY]
            )
            if encoded_ok:
                payload = base64.b64encode(encoded.tobytes()).decode("ascii")
                images.append(f"data:image/jpeg;base64,{payload}")
    finally:
        capture.release()

    if len(images) < 3:
        raise ValueError("Too few representative frames for visual fallback.")
    return images[:5]


def response_format_for(
    dimensions: tuple[str, ...],
) -> type[BaseModel]:
    if not dimensions or any(item not in DIMENSION_MODELS for item in dimensions):
        raise ValueError("Visual response dimensions are invalid.")
    if len(dimensions) != len(set(dimensions)):
        raise ValueError("Visual response dimensions are duplicated.")
    suffix = "_".join(dimensions)
    classifications_model = create_model(
        f"RequestedVerticalPullClassifications_{suffix}",
        __config__=ConfigDict(extra="forbid"),
        **{dimension: (DIMENSION_MODELS[dimension], ...) for dimension in dimensions},
    )
    return create_model(
        f"VerticalPullVisualResponse_{suffix}",
        __config__=ConfigDict(extra="forbid"),
        rep_index=(int, ...),
        classifications=(classifications_model, ...),
    )


def _prompt(rep_index: int, dimensions: tuple[str, ...]) -> str:
    context = {
        "family": "vertical_pull",
        "rep_index": rep_index,
        "unresolved_dimensions": list(dimensions),
    }
    guidance = "\n".join(
        f"{dimension}: {DIMENSION_GUIDANCE[dimension]}" for dimension in dimensions
    )
    return (
        f"Neutral context: {json.dumps(context, separators=(',', ':'))}\n"
        f"Requested definitions:\n{guidance}"
    )


def classify_rep_visual(
    *,
    rep_index: int,
    dimensions: tuple[str, ...],
    image_data_urls: list[str],
) -> VisualClassifierCall:
    if not 3 <= len(image_data_urls) <= 5:
        raise ValueError("Visual fallback requires three to five frames.")
    response_format = response_format_for(dimensions)
    client = OpenAI(
        api_key=settings.openai_api_key,
        timeout=settings.openai_visual_classifier_timeout_seconds,
        max_retries=0,
    )
    response = client.responses.parse(
        model=settings.openai_visual_classifier_model,
        reasoning={"effort": "none"},
        max_output_tokens=300,
        store=False,
        input=[
            {"role": "system", "content": INSTRUCTIONS},
            {
                "role": "user",
                "content": [
                    {"type": "input_text", "text": _prompt(rep_index, dimensions)},
                    *(
                        {
                            "type": "input_image",
                            "image_url": image_data_url,
                            "detail": "auto",
                        }
                        for image_data_url in image_data_urls
                    ),
                ],
            },
        ],
        text_format=response_format,
    )
    if response.output_parsed is None:
        raise ValueError("Visual classifier returned no structured output.")
    parsed = response.output_parsed.model_dump(mode="json")
    if parsed.get("rep_index") != rep_index:
        raise ValueError("Visual classifier returned the wrong rep index.")
    classifications = parsed.get("classifications")
    if not isinstance(classifications, dict) or tuple(classifications) != dimensions:
        raise ValueError("Visual classifier returned unexpected dimensions.")
    result = VisualRepResult.model_validate(parsed)
    usage_object = getattr(response, "usage", None)
    usage = (
        usage_object.model_dump(mode="json")
        if hasattr(usage_object, "model_dump")
        else {}
    )
    return VisualClassifierCall(result=result, usage=usage)


def fuse_visual_classification(
    rep: RepAnalysis,
    visual: VisualRepResult | None,
) -> tuple[RepAnalysis, dict[str, dict]]:
    """Fill deterministic gaps only; never alter mechanics or confident values."""
    variations = dict(rep.variations)
    provenance: dict[str, dict] = {}
    visual_values = visual.classifications if visual is not None else {}

    for dimension in SUPPORTED_DIMENSIONS:
        deterministic = variations.get(dimension, "uncertain")
        if deterministic not in DIMENSION_VALUES[dimension]:
            deterministic = "uncertain"
        visual_item = visual_values.get(dimension)
        detail: dict = {
            "deterministic_value": deterministic,
            "source": "deterministic" if deterministic != "uncertain" else "unresolved",
        }
        if visual_item is not None:
            detail.update(
                visual_value=visual_item.value,
                visual_confidence=visual_item.confidence,
                visual_evidence=visual_item.evidence,
            )
        if (
            deterministic == "uncertain"
            and visual_item is not None
            and visual_item.value != "uncertain"
            and visual_item.confidence == "high"
        ):
            variations[dimension] = visual_item.value
            detail["source"] = "visual_fallback"
        else:
            variations[dimension] = deterministic
        provenance[dimension] = detail

    return replace(rep, variations=variations), provenance
