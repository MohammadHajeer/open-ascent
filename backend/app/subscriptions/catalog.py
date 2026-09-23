from __future__ import annotations

from dataclasses import dataclass

from app.models.enums import EntitlementType, FeatureKey, PlanCode, ResetPolicy


@dataclass(frozen=True)
class EntitlementDefinition:
    feature_key: FeatureKey
    entitlement_type: EntitlementType
    enabled: bool
    allowance_units: int | None = None
    reset_policy: ResetPolicy | None = None

    @classmethod
    def boolean(
        cls, feature_key: FeatureKey, *, enabled: bool
    ) -> EntitlementDefinition:
        return cls(
            feature_key=feature_key,
            entitlement_type=EntitlementType.BOOLEAN,
            enabled=enabled,
        )

    @classmethod
    def metered(
        cls,
        feature_key: FeatureKey,
        *,
        allowance_units: int | None,
    ) -> EntitlementDefinition:
        return cls(
            feature_key=feature_key,
            entitlement_type=EntitlementType.METERED,
            enabled=True,
            allowance_units=allowance_units,
            reset_policy=ResetPolicy.CALENDAR_MONTH_UTC,
        )

    @classmethod
    def unlimited(cls, feature_key: FeatureKey) -> EntitlementDefinition:
        return cls(
            feature_key=feature_key,
            entitlement_type=EntitlementType.UNLIMITED,
            enabled=True,
        )


@dataclass(frozen=True)
class PlanDefinition:
    code: PlanCode
    name: str
    entitlements: tuple[EntitlementDefinition, ...]


# Video-analysis quotas remain pending product configuration. Null metered
# allowances fail closed; unlimited access always uses the distinct type.
PLAN_CATALOG = (
    PlanDefinition(
        code=PlanCode.FREE,
        name="Free",
        entitlements=(
            EntitlementDefinition.metered(
                FeatureKey.VIDEO_ANALYSIS,
                allowance_units=None,
            ),
            EntitlementDefinition.boolean(FeatureKey.AI_COACH_REPLY, enabled=False),
            EntitlementDefinition.metered(
                FeatureKey.TRAINING_PLAN_GENERATION,
                allowance_units=1,
            ),
            EntitlementDefinition.boolean(FeatureKey.LIVE_COACH, enabled=False),
            EntitlementDefinition.boolean(
                FeatureKey.ADAPTIVE_TRAINING_PLANS,
                enabled=False,
            ),
            EntitlementDefinition.boolean(
                FeatureKey.ADVANCED_PROGRESS_INSIGHTS,
                enabled=False,
            ),
        ),
    ),
    PlanDefinition(
        code=PlanCode.PRO,
        name="Pro",
        entitlements=(
            EntitlementDefinition.metered(
                FeatureKey.VIDEO_ANALYSIS,
                allowance_units=None,
            ),
            EntitlementDefinition.unlimited(FeatureKey.AI_COACH_REPLY),
            EntitlementDefinition.metered(
                FeatureKey.TRAINING_PLAN_GENERATION,
                allowance_units=10,
            ),
            EntitlementDefinition.boolean(FeatureKey.LIVE_COACH, enabled=True),
            EntitlementDefinition.boolean(
                FeatureKey.ADAPTIVE_TRAINING_PLANS,
                enabled=True,
            ),
            EntitlementDefinition.boolean(
                FeatureKey.ADVANCED_PROGRESS_INSIGHTS,
                enabled=True,
            ),
        ),
    ),
)


def _validate_catalog() -> None:
    safety_terms = {
        "safety",
        "risk",
        "readiness",
        "prerequisite",
        "caution",
        "stop_condition",
        "disclaimer",
    }
    for plan in PLAN_CATALOG:
        keys = [entitlement.feature_key.value for entitlement in plan.entitlements]
        if len(keys) != len(set(keys)):
            raise ValueError(f"Duplicate feature in {plan.code.value} plan catalog.")
        for key in keys:
            if any(term in key for term in safety_terms):
                raise ValueError("Safety must never be a plan entitlement.")


_validate_catalog()
