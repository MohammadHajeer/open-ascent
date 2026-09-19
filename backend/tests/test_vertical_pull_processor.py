from __future__ import annotations

import uuid
from contextlib import contextmanager
from types import SimpleNamespace

from app.models.analysis import Analysis
from app.models.movement import Movement
from app.services.analysis_jobs import AnalysisClaim
from app.workers import vertical_pull_processor


def test_processor_downloads_private_video_and_returns_analyzer_result(
    monkeypatch,
) -> None:
    movement_id = uuid.uuid4()

    class FakeSession:
        def get(self, model, key):
            if model is Analysis:
                return SimpleNamespace(movement_id=movement_id)
            if model is Movement:
                assert key == movement_id
                return SimpleNamespace(slug="chin-up")
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

    def fake_analyzer(path):
        assert path.read_bytes() == b"video bytes"
        return SimpleNamespace(to_dict=lambda: {"outcome": "zero_valid_reps"})

    monkeypatch.setattr(vertical_pull_processor, "SessionLocal", fake_session)
    monkeypatch.setattr(
        vertical_pull_processor, "supabase", SimpleNamespace(storage=FakeStorage())
    )
    monkeypatch.setattr(
        vertical_pull_processor, "analyze_vertical_pull_video", fake_analyzer
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
