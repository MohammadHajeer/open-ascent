from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from app.analyzers.pull_up.analyzer import analyze_pull_up_video

PROJECT_ROOT = Path(__file__).resolve().parents[1]

MANIFEST_PATH = PROJECT_ROOT / "validation" / "pull_up" / "manifest.json"


def load_manifest() -> dict[str, Any]:
    with MANIFEST_PATH.open(
        "r",
        encoding="utf-8",
    ) as file:
        return json.load(file)


def validate_case(
    *,
    name: str,
    video_path: Path,
    expected: dict[str, Any],
) -> bool:
    try:
        result = analyze_pull_up_video(video_path)

    except Exception as exc:  # noqa: BLE001
        print(f"FAIL {name}")
        print(f"  processing error: {exc}")
        print()

        return False

    actual = result.to_dict()

    failures: list[str] = []

    for key, expected_value in expected.items():
        actual_value = actual.get(key)

        if actual_value != expected_value:
            failures.append(
                f"{key}: expected {expected_value!r}, " f"actual {actual_value!r}"
            )

    if failures:
        print(f"FAIL {name}")

        for failure in failures:
            print(f"  {failure}")

        print()

        return False

    print(f"PASS {name}")

    return True


def main() -> None:
    manifest = load_manifest()

    cases = manifest["cases"]

    passed = 0
    failed = 0

    print()
    print("Open Ascent Pull-Up Validation")
    print("=" * 32)
    print()

    for case in cases:
        name = case["name"]

        video_path = PROJECT_ROOT / case["video"]

        expected = case["expected"]

        success = validate_case(
            name=name,
            video_path=video_path,
            expected=expected,
        )

        if success:
            passed += 1
        else:
            failed += 1

    print()
    print("=" * 32)
    print(f"Passed: {passed}")
    print(f"Failed: {failed}")
    print(f"Total:  {passed + failed}")

    if failed:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
