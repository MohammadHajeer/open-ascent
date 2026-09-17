from __future__ import annotations

from app.schemas.readiness import (
    ReadinessEvidence,
    ReadinessResult,
    ReadinessStatus,
)


class ReadinessService:
    @staticmethod
    def evaluate(
        evidence: list[ReadinessEvidence],
        easier_option: str | None = None,
    ) -> ReadinessResult:
        if not evidence:
            return ReadinessResult(
                status=ReadinessStatus.UNKNOWN,
                missing_evidence=["No readiness evidence available."],
                prescription_allowed=False,
                easier_option=easier_option,
            )

        failed_requirements = [
            item.requirement for item in evidence if item.satisfied is False
        ]

        missing_evidence = [
            item.requirement for item in evidence if item.satisfied is None
        ]

        if failed_requirements:
            status = ReadinessStatus.FAIL
        elif missing_evidence:
            status = ReadinessStatus.UNKNOWN
        else:
            status = ReadinessStatus.PASS

        return ReadinessResult(
            status=status,
            failed_requirements=failed_requirements,
            missing_evidence=missing_evidence,
            prescription_allowed=status is ReadinessStatus.PASS,
            easier_option=(
                easier_option if status is not ReadinessStatus.PASS else None
            ),
        )
