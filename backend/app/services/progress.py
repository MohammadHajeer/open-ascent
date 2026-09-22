from __future__ import annotations

import uuid
from collections import defaultdict
from datetime import UTC, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.movement import Movement
from app.models.training import WorkoutSession, WorkoutSet
from app.schemas.progress import (
    ProgressConsistency,
    ProgressMetricSeries,
    ProgressMovement,
    ProgressSummary,
    ProgressTrendPoint,
)


def _current_week_start(now: datetime) -> datetime:
    current = now.astimezone(UTC)
    start = current - timedelta(days=current.weekday())
    return start.replace(hour=0, minute=0, second=0, microsecond=0)


def get_progress_summary(
    db: Session,
    user_id: uuid.UUID,
    *,
    now: datetime | None = None,
) -> ProgressSummary:
    """Aggregate progress from explicitly self-attributed workout sets only."""
    week_start = _current_week_start(now or datetime.now(UTC))
    movements = list(db.scalars(select(Movement).order_by(Movement.name, Movement.id)))
    rows = list(
        db.execute(
            select(WorkoutSet, WorkoutSession.started_at)
            .join(WorkoutSession, WorkoutSession.id == WorkoutSet.session_id)
            .where(
                WorkoutSession.user_id == user_id,
                WorkoutSet.performer == "self",
            )
            .order_by(
                WorkoutSession.started_at,
                WorkoutSession.id,
                WorkoutSet.position,
                WorkoutSet.id,
            )
        ).tuples()
    )

    weekly_session_ids: set[uuid.UUID] = set()
    weekly_days = set()
    weekly_sets = 0
    points: dict[tuple[uuid.UUID, str], list[ProgressTrendPoint]] = defaultdict(list)

    for workout_set, started_at in rows:
        if started_at >= week_start:
            weekly_session_ids.add(workout_set.session_id)
            weekly_days.add(started_at.astimezone(UTC).date())
            weekly_sets += 1

        if workout_set.reps is not None:
            measurement = "reps"
            value = float(workout_set.reps)
        else:
            measurement = "hold_seconds"
            value = float(workout_set.hold_seconds)

        points[(workout_set.movement_id, measurement)].append(
            ProgressTrendPoint(
                recorded_at=started_at,
                value=value,
                source=workout_set.source,
                intent=workout_set.intent,
                workout_session_id=workout_set.session_id,
                workout_set_id=workout_set.id,
            )
        )

    movement_summaries = []
    for movement in movements:
        metric_summaries = []
        for measurement, label, unit in (
            ("reps", "Reps", "reps"),
            ("hold_seconds", "Hold duration", "seconds"),
        ):
            metric_points = points[(movement.id, measurement)]
            if metric_points:
                metric_summaries.append(
                    ProgressMetricSeries(
                        measurement=measurement,
                        label=label,
                        unit=unit,
                        points=metric_points,
                    )
                )
        movement_summaries.append(
            ProgressMovement(
                id=movement.id,
                name=movement.name,
                metrics=metric_summaries,
            )
        )

    return ProgressSummary(
        consistency=ProgressConsistency(
            week_started_at=week_start,
            workouts_this_week=len(weekly_session_ids),
            active_days_this_week=len(weekly_days),
            sets_this_week=weekly_sets,
        ),
        movements=movement_summaries,
    )
