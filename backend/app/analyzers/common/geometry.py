from __future__ import annotations

import math
from typing import Protocol


class Landmark2D(Protocol):
    x: float
    y: float


def calculate_angle(
    a: Landmark2D,
    b: Landmark2D,
    c: Landmark2D,
) -> float | None:
    """
    Calculate angle ABC in degrees.

    B is the vertex of the angle.

    For an elbow angle:
        A = shoulder
        B = elbow
        C = wrist
    """

    ba_x = a.x - b.x
    ba_y = a.y - b.y

    bc_x = c.x - b.x
    bc_y = c.y - b.y

    ba_length = math.hypot(ba_x, ba_y)
    bc_length = math.hypot(bc_x, bc_y)

    denominator = ba_length * bc_length

    if denominator <= 1e-12:
        return None

    dot_product = (ba_x * bc_x) + (ba_y * bc_y)

    cosine_angle = dot_product / denominator

    # Floating-point calculations can occasionally produce something
    # slightly outside [-1, 1], such as 1.0000000001.
    cosine_angle = max(-1.0, min(1.0, cosine_angle))

    return math.degrees(math.acos(cosine_angle))
