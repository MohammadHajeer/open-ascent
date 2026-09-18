from __future__ import annotations

import argparse
import json
from pathlib import Path

from app.analyzers.pull_up.analyzer import analyze_pull_up_video


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Run the Open Ascent pull-up analyzer."
    )

    parser.add_argument(
        "video",
        type=Path,
        help="Path to the pull-up video.",
    )

    args = parser.parse_args()

    result = analyze_pull_up_video(args.video)

    print()
    print(
        json.dumps(
            result.to_dict(),
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
