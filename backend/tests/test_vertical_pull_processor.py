from __future__ import annotations

import uuid
from contextlib import contextmanager
from types import SimpleNamespace

import pytest

from app.models.analysis import Analysis
from app.models.movement import Movement
from app.services.analysis_jobs import AnalysisClaim
from app.workers import vertical_pull_processor


@pytest.mark.parametrize(
    "slug",
    [
        "pull-up",
        "chin-up",
        "wide-grip-pull-up",
        "close-grip-pull-up",
        "high-pull-up",
    ],
)
def test_processor_dispatches_supported_exercises_by_family(
    monkeypatch,
    slug: str,
) -> None:
    movement_id = uuid.uuid4()
    published = []

    class FakeSession:
        def get(self, model, key):
            if model is Analysis:
                return SimpleNamespace(movement_id=movement_id)
            if model is Movement:
                assert key == movement_id
                return SimpleNamespace(slug=slug, family_key="vertical_pull")
            raise AssertionError("Unexpected model")

    @contextmanager
    def fake_session():
        yield FakeSession()

    class FakeStorage:
        def from_(self, bucket):
            assert bucket == vertical_pull_processor.settings.supabase_video_bucket
            return self

        def download(self, path):
            assert path == "private/source.mp4"
            return b"video bytes"

    def fake_analyzer(path, *, on_rep_completed):
        assert path.read_bytes() == b"video bytes"
        on_rep_completed(SimpleNamespace(rep_index=1, outcome=SimpleNamespace(value="valid")))
        return SimpleNamespace(to_dict=lambda: {"outcome": "zero_valid_reps"})

    monkeypatch.setattr(vertical_pull_processor, "SessionLocal", fake_session)
    monkeypatch.setattr(
        vertical_pull_processor, "supabase", SimpleNamespace(storage=FakeStorage())
    )
    monkeypatch.setattr(
        vertical_pull_processor, "analyze_vertical_pull_video", fake_analyzer
    )
    monkeypatch.setattr(
        vertical_pull_processor,
        "publish_claim_event",
        lambda db, claim, event_type, **kwargs: published.append((event_type, kwargs)),
    )

    result = vertical_pull_processor.process_vertical_pull(
        AnalysisClaim(
            analysis_id=uuid.uuid4(),
            claim_token="claim",
            attempt=1,
            video_path="private/source.mp4",
        )
    )
    assert result.result_data == {"outcome": "zero_valid_reps"}
    assert result.analyzer_version == "vertical_pull_v1"
    assert [event_type for event_type, _ in published] == [
        "video_loaded", "movement_analysis_started", "rep_completed", "finalizing"
    ]
    assert published[2][1] == {"rep_index": 1, "outcome": "valid"}


def test_processor_rejects_an_unknown_family_before_download(monkeypatch) -> None:
    movement_id = uuid.uuid4()

    class FakeSession:
        def get(self, model, key):
            if model is Analysis:
                return SimpleNamespace(movement_id=movement_id)
            if model is Movement:
                return SimpleNamespace(family_key="horizontal_pull")
            raise AssertionError("Unexpected model")

    @contextmanager
    def fake_session():
        yield FakeSession()

    monkeypatch.setattr(vertical_pull_processor, "SessionLocal", fake_session)
    claim = AnalysisClaim(
        analysis_id=uuid.uuid4(),
        claim_token="claim",
        attempt=1,
        video_path="private/source.mp4",
    )
    with pytest.raises(ValueError, match="Unsupported analysis movement family"):
        vertical_pull_processor.process_vertical_pull(claim)
