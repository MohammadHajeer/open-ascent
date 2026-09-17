from app.schemas.readiness import (
    ReadinessEvidence,
    ReadinessStatus,
)
from app.services.readiness import ReadinessService


def test_readiness_passes_when_all_requirements_are_satisfied() -> None:
    result = ReadinessService.evaluate(
        evidence=[
            ReadinessEvidence(
                requirement="Comfortable dead hang",
                satisfied=True,
            ),
            ReadinessEvidence(
                requirement="Adequate pulling strength",
                satisfied=True,
            ),
        ]
    )

    assert result.status is ReadinessStatus.PASS
    assert result.prescription_allowed is True
    assert result.failed_requirements == []
    assert result.missing_evidence == []
    assert result.easier_option is None
    assert result.retrospective_analysis_allowed is True


def test_readiness_fails_when_requirement_is_not_satisfied() -> None:
    result = ReadinessService.evaluate(
        evidence=[
            ReadinessEvidence(
                requirement="Comfortable dead hang",
                satisfied=True,
            ),
            ReadinessEvidence(
                requirement="Adequate pulling strength",
                satisfied=False,
            ),
        ],
        easier_option="Assisted pull-up",
    )

    assert result.status is ReadinessStatus.FAIL
    assert result.prescription_allowed is False
    assert result.failed_requirements == [
        "Adequate pulling strength",
    ]
    assert result.easier_option == "Assisted pull-up"
    assert result.retrospective_analysis_allowed is True


def test_missing_evidence_results_in_unknown_not_pass() -> None:
    result = ReadinessService.evaluate(
        evidence=[
            ReadinessEvidence(
                requirement="Comfortable dead hang",
                satisfied=True,
            ),
            ReadinessEvidence(
                requirement="Adequate pulling strength",
                satisfied=None,
            ),
        ],
        easier_option="Assisted pull-up",
    )

    assert result.status is ReadinessStatus.UNKNOWN
    assert result.prescription_allowed is False
    assert result.missing_evidence == [
        "Adequate pulling strength",
    ]
    assert result.easier_option == "Assisted pull-up"
    assert result.retrospective_analysis_allowed is True


def test_no_evidence_results_in_unknown() -> None:
    result = ReadinessService.evaluate(
        evidence=[],
        easier_option="Assisted pull-up",
    )

    assert result.status is ReadinessStatus.UNKNOWN
    assert result.prescription_allowed is False
    assert result.easier_option == "Assisted pull-up"
    assert result.retrospective_analysis_allowed is True
