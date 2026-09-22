from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db.database import SessionLocal
from app.models.movement import Movement
from app.models.movement_documentation import MovementDocumentation
from app.schemas.movement_safety import MovementSafetyContent

MOVEMENTS = [
    {
        "slug": "pull-up",
        "name": "Pull-Up",
        "family_key": "vertical_pull",
        "illustration_path": "pull-up.png",
        "documentation": {
            "notice": (
                "Perform pull-ups on a stable bar using controlled movement. "
                "Avoid forcing range of motion or continuing when grip or body "
                "control begins to break down."
            ),
            "difficulty": "intermediate",
            "stressed_areas": [
                "shoulders",
                "elbows",
                "forearms",
                "upper back",
            ],
            "prerequisites": [
                "Comfortable supported or dead hang",
                "Basic scapular control",
                "Enough grip strength to remain securely on the bar",
            ],
            "cautions": [
                "Avoid excessive swinging unless the intended variation requires it",
                "Do not force the chin over the bar by excessively extending the neck",
                "Lower under control instead of suddenly dropping",
            ],
            "stop_conditions": [
                "Sharp or increasing shoulder or elbow pain",
                "Loss of grip control",
                "Numbness or tingling in the arms or hands",
                "Dizziness or unusual shortness of breath",
            ],
            "easier_option": (
                "Use a band-assisted pull-up or controlled eccentric pull-ups."
            ),
            "setup": [
                "Use a stable pull-up bar with enough clearance around the body",
                "Grip the bar securely before leaving the ground",
                "Begin from a controlled hanging position",
            ],
        },
    },
    {
        "slug": "chin-up",
        "name": "Chin-Up",
        "family_key": "vertical_pull",
        "illustration_path": "chin-up.png",
        "documentation": {
            "notice": (
                "Use a controlled supinated grip and avoid forcing the wrists, "
                "elbows, or shoulders into uncomfortable positions."
            ),
            "difficulty": "intermediate",
            "stressed_areas": [
                "elbows",
                "wrists",
                "shoulders",
                "forearms",
                "upper back",
            ],
            "prerequisites": [
                "Comfortable hanging position",
                "Pain-free supinated grip",
                "Basic pulling strength and scapular control",
            ],
            "cautions": [
                "Keep the wrists in a comfortable position",
                "Avoid uncontrolled swinging",
                "Do not abruptly drop from the top position",
            ],
            "stop_conditions": [
                "Sharp elbow, wrist, or shoulder pain",
                "Loss of grip control",
                "Numbness or tingling in the hands or arms",
            ],
            "easier_option": "Use a band-assisted chin-up or controlled negatives.",
            "setup": [
                "Use a stable bar",
                "Take a secure palms-toward-you grip",
                "Ensure adequate clearance below the bar",
            ],
        },
    },
    {
        "slug": "close-grip-pull-up",
        "name": "Close-Grip Pull-Up",
        "family_key": "vertical_pull",
        "illustration_path": "close-grip-pull-up.png",
        "documentation": {
            "notice": (
                "Use a grip width that remains comfortable for the wrists, elbows, "
                "and shoulders while maintaining controlled pulling mechanics."
            ),
            "difficulty": "intermediate",
            "stressed_areas": [
                "shoulders",
                "elbows",
                "forearms",
                "upper back",
            ],
            "prerequisites": [
                "Comfortable standard pull-up technique",
                "Secure grip strength",
                "Pain-free close-grip hanging position",
            ],
            "cautions": [
                "Do not force the hands unusually close together",
                "Avoid swinging or jerking to initiate repetitions",
                "Maintain controlled lowering",
            ],
            "stop_conditions": [
                "Sharp wrist, elbow, or shoulder pain",
                "Loss of grip",
                "Loss of controlled movement",
            ],
            "easier_option": (
                "Use a standard-width pull-up or an assisted close-grip pull-up."
            ),
            "setup": [
                "Use a stable bar",
                "Choose a comfortable close grip",
                "Start from a controlled hanging position",
            ],
        },
    },
    {
        "slug": "wide-grip-pull-up",
        "name": "Wide-Grip Pull-Up",
        "family_key": "vertical_pull",
        "illustration_path": "wide-grip-pull-up.png",
        "documentation": {
            "notice": (
                "A wider grip can increase shoulder demand. Use only a width that "
                "allows comfortable, controlled movement without forcing range."
            ),
            "difficulty": "intermediate",
            "stressed_areas": [
                "shoulders",
                "elbows",
                "upper back",
                "forearms",
            ],
            "prerequisites": [
                "Comfortable standard pull-ups",
                "Adequate overhead shoulder mobility",
                "Secure grip strength",
            ],
            "cautions": [
                "Do not use an excessively wide grip",
                "Avoid forcing the shoulders into painful positions",
                "Avoid uncontrolled swinging",
            ],
            "stop_conditions": [
                "Sharp shoulder or elbow pain",
                "Loss of grip",
                "Painful or restricted shoulder movement",
            ],
            "easier_option": "Return to a standard-width pull-up.",
            "setup": [
                "Use a stable bar",
                "Select a moderately wide grip that remains comfortable",
                "Ensure enough clearance around the body",
            ],
        },
    },
    {
        "slug": "high-pull-up",
        "name": "High Pull-Up",
        "family_key": "vertical_pull",
        "illustration_path": "high-pull-up.png",
        "documentation": {
            "notice": (
                "High pull-ups require greater pulling power and control than a "
                "standard pull-up. Build the movement progressively."
            ),
            "difficulty": "advanced",
            "stressed_areas": [
                "shoulders",
                "elbows",
                "upper back",
                "forearms",
                "core",
            ],
            "prerequisites": [
                "Consistent strict pull-ups",
                "Strong scapular control",
                "Ability to pull explosively without losing body control",
            ],
            "cautions": [
                "Do not rely on uncontrolled swinging to create height",
                "Keep the bar path controlled",
                "Avoid sudden dropping after the high pull",
            ],
            "stop_conditions": [
                "Sharp shoulder or elbow pain",
                "Loss of grip",
                "Repeated inability to control the descent",
            ],
            "easier_option": "Practice strict chest-to-bar or powerful pull-ups.",
            "setup": [
                "Use a stable high bar with generous clearance",
                "Ensure the surrounding area is free of obstacles",
                "Begin with a secure grip and controlled body position",
            ],
        },
    },
    {
        "slug": "muscle-up",
        "name": "Muscle-Up",
        "family_key": "muscle_up",
        "illustration_path": "muscle-up.png",
        "documentation": {
            "notice": (
                "The muscle-up combines a powerful pull, transition, and support "
                "position. It should be attempted only with sufficient pulling, "
                "dipping, and transition control."
            ),
            "difficulty": "advanced",
            "stressed_areas": [
                "shoulders",
                "elbows",
                "wrists",
                "upper back",
                "chest",
                "core",
            ],
            "prerequisites": [
                "Strong controlled pull-ups",
                "Strong straight-bar support or dipping ability",
                "Adequate wrist and shoulder mobility",
                "Ability to perform powerful high pulls with control",
            ],
            "cautions": [
                "Avoid forcing the transition when the elbows or shoulders are poorly positioned",
                "Do not continue repetitions after pulling power significantly drops",
                "Use adequate clearance above and around the bar",
            ],
            "stop_conditions": [
                "Sharp shoulder, elbow, or wrist pain",
                "Loss of grip during the transition",
                "Repeated uncontrolled impact against the bar",
                "Loss of safe support above the bar",
            ],
            "easier_option": (
                "Practice high pull-ups, transition drills, and controlled "
                "straight-bar dips separately."
            ),
            "setup": [
                "Use a stable bar rated for dynamic bodyweight movement",
                "Ensure substantial clearance above and around the bar",
                "Begin with a secure grip and controlled hang",
            ],
        },
    },
    {
        "slug": "dips",
        "name": "Dips",
        "family_key": "vertical_push",
        "illustration_path": "dips.png",
        "documentation": {
            "notice": (
                "Perform dips through a comfortable shoulder range and maintain "
                "control throughout both the lowering and pressing phases."
            ),
            "difficulty": "intermediate",
            "stressed_areas": [
                "shoulders",
                "elbows",
                "chest",
                "triceps",
            ],
            "prerequisites": [
                "Stable support hold",
                "Pain-free shoulder extension within the intended range",
                "Basic pressing strength",
            ],
            "cautions": [
                "Do not force excessive depth",
                "Avoid bouncing at the bottom",
                "Keep the shoulders and elbows under control",
            ],
            "stop_conditions": [
                "Sharp shoulder or elbow pain",
                "Loss of support stability",
                "Inability to control the lowering phase",
            ],
            "easier_option": "Use assisted dips or reduce the range of motion.",
            "setup": [
                "Use stable parallel bars",
                "Confirm sufficient clearance beneath the body",
                "Begin from a stable supported position",
            ],
        },
    },
    {
        "slug": "push-up",
        "name": "Push-Up",
        "family_key": "horizontal_push",
        "illustration_path": "push-up.png",
        "documentation": {
            "notice": (
                "Maintain a controlled body position and use a range of motion "
                "that remains comfortable for the wrists and shoulders."
            ),
            "difficulty": "beginner",
            "stressed_areas": [
                "wrists",
                "shoulders",
                "elbows",
                "chest",
                "core",
            ],
            "prerequisites": [
                "Ability to support body weight through the hands without pain",
                "Basic plank control",
            ],
            "cautions": [
                "Avoid allowing the hips or lower back to collapse",
                "Keep the hands and wrists in a comfortable position",
                "Avoid bouncing at the bottom",
            ],
            "stop_conditions": [
                "Sharp wrist, shoulder, or elbow pain",
                "Loss of body control",
                "Numbness or tingling in the hands",
            ],
            "easier_option": "Use an incline push-up on a stable elevated surface.",
            "setup": [
                "Use a stable, non-slip surface",
                "Place the hands securely before loading them",
                "Begin with the body under controlled tension",
            ],
        },
    },
    {
        "slug": "front-lever",
        "name": "Front Lever",
        "family_key": "lever",
        "illustration_path": "front-lever.png",
        "documentation": {
            "notice": (
                "The front lever is an advanced straight-arm skill requiring "
                "substantial shoulder, back, core, and connective-tissue readiness. "
                "Progress through easier lever positions first."
            ),
            "difficulty": "advanced",
            "stressed_areas": [
                "shoulders",
                "elbows",
                "upper back",
                "forearms",
                "core",
            ],
            "prerequisites": [
                "Strong and comfortable hanging position",
                "Good scapular control",
                "Experience with easier front lever progressions",
                "Ability to maintain straight-arm tension without pain",
            ],
            "cautions": [
                "Do not force a full lever before easier progressions are controlled",
                "Avoid suddenly dropping out of the hold",
                "Keep the elbows controlled rather than allowing unintended bending",
            ],
            "stop_conditions": [
                "Sharp shoulder or elbow pain",
                "Loss of grip",
                "Inability to control entry or exit",
                "Sudden loss of straight-arm control",
            ],
            "easier_option": "Use a tuck or advanced-tuck front lever progression.",
            "setup": [
                "Use a stable bar with adequate clearance",
                "Ensure enough space for the full body to extend horizontally",
                "Enter the progression under control",
            ],
        },
    },
    {
        "slug": "back-lever",
        "name": "Back Lever",
        "family_key": "lever",
        "illustration_path": "back-lever.png",
        "documentation": {
            "notice": (
                "The back lever is an advanced straight-arm hold with significant "
                "shoulder and elbow demands. Progress gradually and avoid forcing "
                "shoulder extension."
            ),
            "difficulty": "advanced",
            "stressed_areas": [
                "shoulders",
                "elbows",
                "chest",
                "upper back",
                "core",
            ],
            "prerequisites": [
                "Comfortable support and hanging strength",
                "Adequate shoulder extension mobility",
                "Controlled experience with easier back lever progressions",
                "Pain-free straight-arm loading",
            ],
            "cautions": [
                "Do not force shoulder extension",
                "Progress through tuck variations before harder positions",
                "Avoid uncontrolled entry or sudden dropping",
            ],
            "stop_conditions": [
                "Sharp shoulder, elbow, or chest discomfort",
                "Loss of grip",
                "Loss of controlled entry or exit",
                "Pain during straight-arm loading",
            ],
            "easier_option": "Use a tuck back lever progression.",
            "setup": [
                "Use a stable bar with enough surrounding clearance",
                "Confirm the grip is secure before rotating into position",
                "Enter and exit the progression under control",
            ],
        },
    },
    {
        "slug": "inverted-deadlift",
        "name": "Inverted Deadlift",
        "family_key": "inverted_pull",
        "illustration_path": "inverted-deadlift.png",
        "documentation": {
            "notice": (
                "The inverted deadlift is an advanced inverted pulling movement. "
                "Use a controlled progression and only work through positions that "
                "can be entered and exited safely."
            ),
            "difficulty": "advanced",
            "stressed_areas": [
                "shoulders",
                "upper back",
                "elbows",
                "forearms",
                "core",
                "posterior chain",
            ],
            "prerequisites": [
                "Comfortable controlled inverted position",
                "Strong grip and scapular control",
                "Experience with related inverted pulling progressions",
                "Ability to enter and exit inversion safely",
            ],
            "cautions": [
                "Avoid rapid or uncontrolled inversion",
                "Do not continue if orientation or balance becomes disorienting",
                "Maintain sufficient clearance throughout the movement",
            ],
            "stop_conditions": [
                "Sharp shoulder, elbow, neck, or back pain",
                "Loss of grip",
                "Dizziness or disorientation",
                "Inability to control the return from the inverted position",
            ],
            "easier_option": (
                "Practice a controlled inverted hang or a reduced-range "
                "inverted pulling progression."
            ),
            "setup": [
                "Use stable equipment with generous clearance",
                "Ensure the area below and around the body is unobstructed",
                "Begin from a position that allows a controlled entry into inversion",
            ],
        },
    },
]


def next_documentation_version(
    db: Session,
    movement_id,
) -> int:
    latest_version = db.scalar(
        select(func.max(MovementDocumentation.version)).where(
            MovementDocumentation.movement_id == movement_id
        )
    )

    return (latest_version or 0) + 1


def seed_movement(
    db: Session,
    seed: dict,
) -> tuple[bool, bool]:
    movement = db.scalar(
        select(Movement).where(
            Movement.slug == seed["slug"],
        )
    )

    movement_created = False
    documentation_created = False

    if movement is None:
        movement = Movement(
            slug=seed["slug"],
            name=seed["name"],
            family_key=seed["family_key"],
            illustration_path=seed["illustration_path"],
            upload_analysis_supported=seed["family_key"] == "vertical_pull",
            live_coach_supported=seed["slug"] == "pull-up",
        )

        db.add(movement)
        db.flush()

        movement_created = True

        print(f"Created movement: {movement.name}")
    else:
        # Do not overwrite movement data that may later be managed by an admin.
        if movement.illustration_path is None:
            movement.illustration_path = seed["illustration_path"]

        print(f"Movement already exists: {movement.name}")

    published = db.scalar(
        select(MovementDocumentation).where(
            MovementDocumentation.movement_id == movement.id,
            MovementDocumentation.status == "published",
        )
    )

    if published is not None:
        print(
            f"  Published documentation already exists "
            f"(v{published.version}); leaving it unchanged."
        )
        return movement_created, documentation_created

    draft = db.scalar(
        select(MovementDocumentation).where(
            MovementDocumentation.movement_id == movement.id,
            MovementDocumentation.status == "draft",
        )
    )

    if draft is not None:
        print("  Draft documentation already exists; leaving documentation untouched.")
        return movement_created, documentation_created

    validated_content = MovementSafetyContent.model_validate(seed["documentation"])

    documentation = MovementDocumentation(
        movement_id=movement.id,
        version=next_documentation_version(db, movement.id),
        status="published",
        content=validated_content.model_dump(exclude_none=True),
        created_by=None,
        published_by=None,
        published_at=datetime.now(UTC),
        edit_revision=1,
    )

    db.add(documentation)

    documentation_created = True

    print(f"  Seeded published documentation v{documentation.version}.")

    return movement_created, documentation_created


def main() -> None:
    created_movements = 0
    created_documentation = 0

    with SessionLocal() as db:
        try:
            # Validate every document before writing anything to PostgreSQL.
            for seed in MOVEMENTS:
                MovementSafetyContent.model_validate(seed["documentation"])

            for seed in MOVEMENTS:
                movement_created, documentation_created = seed_movement(
                    db,
                    seed,
                )

                created_movements += int(movement_created)
                created_documentation += int(documentation_created)

            db.commit()

        except Exception:
            db.rollback()
            raise

    print()
    print("Open Ascent movement seed complete.")
    print(f"Movements created: {created_movements}")
    print(f"Published guides created: {created_documentation}")
    print(f"Total seed definitions: {len(MOVEMENTS)}")


if __name__ == "__main__":
    main()
