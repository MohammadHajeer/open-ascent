"""Versioned signatures for supported vertical-pull intentions.

Only named dimensions constrain a target. Additional attributes remain valid.
"""

from __future__ import annotations

from dataclasses import replace

from app.analyzers.common.types import RepAnalysis

TARGET_SIGNATURES_V1: dict[str, dict[str, str]] = {
    "pull-up": {"base_movement": "pull_up"},
    "chin-up": {"base_movement": "chin_up"},
    "close-grip-pull-up": {"base_movement": "pull_up", "grip_width": "close"},
    "wide-grip-pull-up": {"base_movement": "pull_up", "grip_width": "wide"},
    "high-pull-up": {"base_movement": "pull_up", "pull_height": "high"},
}


def compare_rep(rep: RepAnalysis, target_slug: str | None) -> RepAnalysis:
    if target_slug is None:
        return rep
    signature = TARGET_SIGNATURES_V1.get(target_slug)
    if signature is None:
        return rep
    deviations = [
        {"dimension": dimension, "expected": expected, "detected": detected}
        for dimension, expected in signature.items()
        if (detected := rep.variations.get(dimension, "uncertain"))
        not in {expected, "uncertain"}
    ]
    # A missing required dimension is not a positive match or a deviation.
    unresolved = any(
        rep.variations.get(dimension, "uncertain") == "uncertain"
        for dimension in signature
    )
    return replace(
        rep,
        target_match=False if deviations else None if unresolved else True,
        target_deviations=deviations,
    )
