"""Explicit, non-production demo setup. Run from backend with ``uv run python -m scripts.seed_demo``.

The rich phase links real completed uploads; it never manufactures analyzer output.
"""

from __future__ import annotations

import argparse
import os
import uuid
from datetime import UTC, datetime, timedelta

ADMIN_EMAIL = "demo.admin@openascent.example"
ATHLETE_EMAIL = "demo.pro@openascent.example"
ADMIN_NAME = "Mohammad Zeidan"
ATHLETE_NAME = "Yazan Al Rifaee"
MARKER = "open-ascent-doc-02"
NAMESPACE = uuid.UUID("5a00c5b0-74a6-4eb4-a72a-ea8901f1ab87")


def required_env(names: tuple[str, ...]) -> None:
    missing = [name for name in names if not os.getenv(name)]
    if missing:
        raise SystemExit(
            "Missing required environment variables: " + ", ".join(missing)
        )
    if os.getenv("APP_ENV", "development") == "production":
        raise SystemExit("Demo seed is disabled in production.")


def stable_id(label: str) -> uuid.UUID:
    return uuid.uuid5(NAMESPACE, label)


def demo_user(db, client, email: str, password: str, role: str):
    from sqlalchemy import text

    from app.models.profile import Profile

    row = db.execute(
        text(
            "SELECT id, raw_app_meta_data, email_confirmed_at FROM auth.users WHERE lower(email) = :email"
        ),
        {"email": email},
    ).first()
    if row:
        if (row.raw_app_meta_data or {}).get("open_ascent_demo") != MARKER:
            raise RuntimeError(
                f"{email} exists without the {MARKER} marker; refusing takeover"
            )
        user_id = row.id
        if row.email_confirmed_at is None:
            client.auth.admin.update_user_by_id(str(user_id), {"email_confirm": True})
    else:
        response = client.auth.admin.create_user(
            {
                "email": email,
                "password": password,
                "email_confirm": True,
                "app_metadata": {"open_ascent_demo": MARKER},
            }
        )
        if response.user is None:
            raise RuntimeError(f"Supabase did not create {email}")
        user_id = uuid.UUID(str(response.user.id))

    profile = db.get(Profile, user_id)
    display_name = ATHLETE_NAME if role == "athlete" else ADMIN_NAME
    if profile is None:
        profile = Profile(
            id=user_id,
            display_name=display_name,
            app_role=role,
        )
        db.add(profile)
        db.flush()
    elif profile.app_role != role:
        raise RuntimeError(f"{email} has an unexpected role; refusing to change it")
    else:
        profile.display_name = display_name
    return profile


def onboard(db, profile, movements, now):
    from app.core.safety import CURRENT_SAFETY_ACK_VERSION
    from app.schemas.onboarding import AssessmentAnswers
    from app.services.onboarding import build_assessment, derive_athlete_state

    if profile.onboarding_completed_at is not None:
        if (profile.coaching_context or {}).get("demo_seed") != MARKER:
            raise RuntimeError(
                "Athlete has non-demo onboarding; refusing to overwrite it"
            )
        return
    baseline_at = now - timedelta(days=28)
    answers = AssessmentAnswers.model_validate(
        {
            "training_experience": "some",
            "max_clean_reps": {"pull_up": 3, "push_up": 12, "dips": 4},
            "dimension_stage": {
                "pulling": "building",
                "pushing": "building",
                "core": "building",
                "balance": "new",
                "statics": "new",
            },
            "skill_progression": None,
        }
    )
    assessment = build_assessment(answers, baseline_at)
    profile.coaching_context = {
        "schema_version": 1,
        "demo_seed": MARKER,
        "primary_goal": "strength",
        "equipment": ["pull_up_bar", "dip_bars"],
        "availability": {"days_per_week": 3, "minutes_per_session": 40},
        "avoid_movement_ids": [],
    }
    profile.initial_assessment = assessment
    profile.athlete_state = derive_athlete_state(
        assessment,
        {slug: str(movements[slug].id) for slug in ("pull-up", "push-up", "dips")},
    )
    profile.safety_ack_version = CURRENT_SAFETY_ACK_VERSION
    profile.safety_acknowledged_at = baseline_at
    profile.onboarding_completed_at = baseline_at
    profile.dashboard_tour_status = "completed"


def verify_pro(db, profile, subscription_id: str, settings, now):
    from sqlalchemy import select

    from app.models.subscription import SubscriptionPlan, UserSubscription
    from app.services.entitlements import resolve_effective_plan
    from app.services.stripe_webhooks import (
        StripeTestSubscriptionGateway,
        _object_id,
        _validated_period_and_price,
        _value,
    )

    if not settings.stripe_secret_key.startswith("sk_test_"):
        raise RuntimeError("A Stripe test secret key is required")
    client = StripeTestSubscriptionGateway(settings.stripe_secret_key).client
    subscription = client.v1.subscriptions.retrieve(
        subscription_id, {"expand": ["items.data.price"]}
    )
    customer_id = _object_id(_value(subscription, "customer"))
    if _value(subscription, "livemode") is not False or not customer_id:
        raise RuntimeError("Expected a Stripe test subscription with a customer")
    customer = client.v1.customers.retrieve(customer_id)
    metadata = _value(customer, "metadata") or {}
    if _value(customer, "livemode") is not False or _value(
        metadata, "open_ascent_user_id"
    ) != str(profile.id):
        raise RuntimeError("Stripe test customer must belong to this demo athlete")
    plan = db.scalar(
        select(SubscriptionPlan).where(
            SubscriptionPlan.code == "pro",
            SubscriptionPlan.is_active.is_(True),
            SubscriptionPlan.stripe_price_id == settings.stripe_pro_price_id,
        )
    )
    if plan is None:
        raise RuntimeError("Seed the configured Pro plan first")
    period = _validated_period_and_price(
        subscription, expected_price_id=plan.stripe_price_id
    )
    if not period or not all(period) or _value(subscription, "status") != "active":
        raise RuntimeError(
            "Stripe test subscription is not active on the configured monthly Pro price"
        )
    start, end = period
    if not start <= now < end:
        raise RuntimeError("Stripe test subscription is outside its current period")
    member = db.scalar(
        select(UserSubscription).where(UserSubscription.user_id == profile.id)
    )
    if member is None:
        member = UserSubscription(user_id=profile.id, plan_id=plan.id)
        db.add(member)
    if member.stripe_subscription_id not in (None, subscription_id):
        raise RuntimeError(
            "Athlete has a different subscription; refusing to replace it"
        )
    profile.stripe_customer_id = customer_id
    member.plan_id = plan.id
    member.provider_status = "active"
    member.stripe_subscription_id = subscription_id
    member.current_period_start = start
    member.current_period_end = end
    member.effective_start = start
    member.effective_end = end
    member.last_verified_at = now
    member.cancel_at_period_end = bool(
        _value(subscription, "cancel_at_period_end", False)
    )
    member.sync_revision = (member.sync_revision or 0) + 1
    db.flush()
    if resolve_effective_plan(db, profile.id).value != "pro":
        raise RuntimeError(
            "Pro entitlement did not resolve after provider verification"
        )


def seed_workouts(db, profile, movements, now):
    from app.models.training import WorkoutSession, WorkoutSet

    # Historical self reports provide progress, but never a measured capability.
    sessions = [
        (23, 3, 12, 4),
        (19, 4, 13, 5),
        (16, 4, 14, 5),
        (12, 5, 15, 6),
        (9, 5, 16, 6),
        (5, 6, 18, 7),
        (2, 6, 18, 7),
    ]
    for days, pull, push, dips in sessions:
        when = now - timedelta(days=days)
        session_id = stable_id(f"{profile.id}:workout:{days}")
        if db.get(WorkoutSession, session_id) is not None:
            continue
        db.add(
            WorkoutSession(
                id=session_id,
                user_id=profile.id,
                source="manual",
                started_at=when,
                completed_at=when + timedelta(minutes=38),
                notes="Demo training log: controlled full range, comfortable effort.",
            )
        )
        for position, (slug, reps) in enumerate(
            (
                ("pull-up", pull),
                ("push-up", push),
                ("dips", dips),
            )
        ):
            db.add(
                WorkoutSet(
                    id=stable_id(f"{session_id}:{slug}"),
                    session_id=session_id,
                    movement_id=movements[slug].id,
                    position=position,
                    source="manual",
                    performer="self",
                    intent="training_set",
                    reps=reps,
                )
            )
    db.flush()


def link_analyses(db, profile, analysis_ids):
    from sqlalchemy import select

    from app.models.analysis import Analysis
    from app.models.training import WorkoutSession, WorkoutSet
    from app.services.athlete_state import recalibrate_from_analysis
    from app.services.readiness_evidence import _target_matched_rep_count

    measured = 0
    analyses = []
    for analysis_id in set(analysis_ids):
        analysis = db.get(Analysis, analysis_id)
        if (
            analysis is None
            or analysis.user_id != profile.id
            or analysis.owner_kind != "authenticated"
            or analysis.status != "completed"
            or analysis.movement_id is None
            or analysis.completed_at is None
            or analysis.execution_intent != "max_test"
        ):
            raise RuntimeError(
                f"{analysis_id} is not an owned completed max-test upload"
            )
        analyses.append(analysis)
    for analysis in sorted(analyses, key=lambda item: item.completed_at):
        analysis_id = analysis.id
        matched = _target_matched_rep_count(analysis)
        if matched is None or matched <= 0 or matched != analysis.valid_rep_count:
            raise RuntimeError(f"{analysis_id} lacks unambiguous analyzer matched reps")
        session_id = stable_id(f"{profile.id}:analysis-session:{analysis_id}")
        existing = db.scalar(
            select(WorkoutSet).where(WorkoutSet.analysis_id == analysis_id)
        )
        if existing is not None:
            session = db.get(WorkoutSession, existing.session_id)
            if (
                session is None
                or session.user_id != profile.id
                or existing.movement_id != analysis.movement_id
                or existing.source != "uploaded_analysis"
                or existing.performer != "self"
                or existing.intent != "max_test"
            ):
                raise RuntimeError(
                    f"{analysis_id} has an incompatible existing workout link"
                )
        elif db.get(WorkoutSession, session_id) is None:
            db.add(
                WorkoutSession(
                    id=session_id,
                    user_id=profile.id,
                    source="uploaded_analysis",
                    started_at=analysis.completed_at,
                    completed_at=analysis.completed_at,
                    notes="Demo max test linked to a completed uploaded analysis.",
                )
            )
            db.add(
                WorkoutSet(
                    id=stable_id(f"{session_id}:set"),
                    session_id=session_id,
                    movement_id=analysis.movement_id,
                    analysis_id=analysis_id,
                    analysis_segment_key="demo-max-test",
                    position=0,
                    source="uploaded_analysis",
                    performer="self",
                    intent="max_test",
                    reps=matched,
                )
            )
            db.flush()
        if recalibrate_from_analysis(db, user_id=profile.id, analysis_id=analysis_id):
            measured += 1
    if measured == 0 and not any(
        item.get("source") == "uploaded_analysis"
        for item in (profile.athlete_state or {}).get("capabilities", {}).values()
    ):
        raise RuntimeError("No qualifying measured capability was established")
    return measured


def save_valid_plan(db, profile, movements):
    from app.models.training import TrainingPlan
    from app.schemas.readiness import ReadinessStatus
    from app.schemas.training_plan import WeeklyPlanCandidate
    from app.services.readiness import ReadinessService
    from app.services.readiness_evidence import ReadinessEvidenceBuilder
    from app.services.training_plan import validate_candidate

    plan_id = stable_id(f"{profile.id}:weekly-plan")
    allowed = []
    for slug in ("pull-up", "push-up", "dips"):
        movement = movements[slug]
        evidence = ReadinessEvidenceBuilder.build(
            db, user_id=profile.id, movement_id=movement.id
        )
        if ReadinessService.evaluate(evidence).status is ReadinessStatus.PASS:
            allowed.append(movement)
    if not allowed:
        return False
    existing = db.get(TrainingPlan, plan_id)
    if existing is not None:
        validate_candidate(
            db, profile.id, WeeklyPlanCandidate.model_validate(existing.plan_document)
        )
        return True
    candidate = WeeklyPlanCandidate.model_validate(
        {
            "title": "Demo strength foundation · three days",
            "summary": "A manageable week based on current recorded evidence.",
            "days": [
                {
                    "day_index": index,
                    "label": label,
                    "exercises": [
                        {
                            "movement_id": movement.id,
                            "sets": 3,
                            "reps": min(
                                3 if movement.slug == "pull-up" else 8,
                                max(
                                    1,
                                    (profile.athlete_state or {})
                                    .get("capabilities", {})
                                    .get(str(movement.id), {})
                                    .get("value", 3),
                                ),
                            ),
                            "rest_seconds": 120,
                            "notes": "Stop if form or comfort declines.",
                        }
                        for movement in allowed
                    ],
                }
                for index, label in ((1, "Monday"), (3, "Wednesday"), (5, "Friday"))
            ],
        }
    )
    validate_candidate(db, profile.id, candidate)
    db.add(
        TrainingPlan(
            id=plan_id,
            user_id=profile.id,
            title=candidate.title,
            plan_document=candidate.model_dump(mode="json"),
        )
    )
    return True


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("phase", choices=("accounts", "rich"))
    parser.add_argument(
        "--stripe-subscription-id", help="Existing active Stripe test subscription"
    )
    parser.add_argument(
        "--analysis-id",
        type=uuid.UUID,
        action="append",
        default=[],
        help="Owned completed max-test upload; repeat for multiple analyses",
    )
    args = parser.parse_args()
    required_env(
        (
            "DATABASE_URL",
            "SUPABASE_URL",
            "SUPABASE_SERVICE_ROLE_KEY",
            "DEMO_ADMIN_PASSWORD",
            "DEMO_ATHLETE_PASSWORD",
            "OPENAI_API_KEY",
            "OPENAI_MODEL",
            "STRIPE_SECRET_KEY",
            "STRIPE_PRO_PRICE_ID",
            "GUEST_TOKEN_SECRET",
        )
    )
    if args.phase == "rich" and not args.stripe_subscription_id:
        parser.error("rich requires --stripe-subscription-id")

    from sqlalchemy import select

    from app.core.config import settings
    from app.core.supabase import supabase
    from app.db.database import SessionLocal
    from app.models.movement import Movement
    from app.services.entitlements import seed_plan_catalog

    now = datetime.now(UTC)
    if settings.app_env == "production":
        raise SystemExit("Demo seed is disabled in production.")
    if not settings.stripe_secret_key.startswith("sk_test_"):
        raise SystemExit("Demo seed requires a Stripe test secret key.")
    with SessionLocal() as db:
        try:
            movements = {
                m.slug: m
                for m in db.scalars(
                    select(Movement).where(
                        Movement.slug.in_(("pull-up", "push-up", "dips"))
                    )
                )
            }
            if len(movements) != 3:
                raise RuntimeError("Seed movements before demo accounts")
            seed_plan_catalog(db, pro_stripe_price_id=settings.stripe_pro_price_id)
            admin = demo_user(
                db, supabase, ADMIN_EMAIL, os.environ["DEMO_ADMIN_PASSWORD"], "admin"
            )
            athlete = demo_user(
                db,
                supabase,
                ATHLETE_EMAIL,
                os.environ["DEMO_ATHLETE_PASSWORD"],
                "athlete",
            )
            onboard(db, athlete, movements, now)
            if args.phase == "rich":
                verify_pro(db, athlete, args.stripe_subscription_id, settings, now)
                seed_workouts(db, athlete, movements, now)
                changed = (
                    link_analyses(db, athlete, args.analysis_id)
                    if args.analysis_id
                    else 0
                )
                saved = save_valid_plan(db, athlete, movements)
                print(
                    f"Measured recalibrations: {changed}; validated saved plan: {saved}"
                )
            db.commit()
            print(
                f"Demo accounts ready: {ADMIN_EMAIL} ({admin.id}), {ATHLETE_EMAIL} ({athlete.id})"
            )
        except Exception:
            db.rollback()
            raise


if __name__ == "__main__":
    main()
