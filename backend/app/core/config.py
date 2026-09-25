from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # App
    app_env: Literal["development", "test", "production"] = "development"
    frontend_url: str = "http://localhost:3000"

    # Database
    database_url: str

    # Supabase
    supabase_url: str
    supabase_service_role_key: str
    supabase_video_bucket: str = "analysis-videos"

    # OpenAI
    openai_api_key: str
    openai_model: str
    openai_coach_model: str = "gpt-6-luna"
    # Chat replies only; plan generation keeps the provider default. "low" roughly
    # halves time to first token versus the provider default ("medium").
    openai_coach_reasoning_effort: Literal["none", "low", "medium", "high"] = "low"
    # Coach latency marks are always logged outside production; opt in there.
    coach_timing_log: bool = False
    openai_visual_classifier_enabled: bool = True
    openai_visual_classifier_model: str = "gpt-6-luna"
    openai_visual_classifier_timeout_seconds: float = 30.0

    # Stripe
    stripe_secret_key: str
    stripe_webhook_secret: str | None = None
    stripe_pro_price_id: str

    # Guest analysis
    guest_token_secret: str

    guest_reservation_ttl_minutes: int = 15
    guest_access_ttl_minutes: int = 60
    guest_purge_ttl_hours: int = 24
    guest_rate_window_minutes: int = 60
    guest_reservations_per_window: int = 5
    guest_cleanup_batch_size: int = 50
    guest_cleanup_interval_seconds: int = 900

    guest_daily_limit: int = Field(default=1, ge=1, le=1)
    guest_global_daily_limit: int = Field(default=100, ge=1, le=100)
    guest_video_max_size_mb: int = Field(default=10, ge=1, le=10)
    guest_video_max_duration_seconds: int = Field(default=20, ge=1, le=20)

    # Keep the pre-hardening limits for signed-in athletes.
    authenticated_video_max_size_mb: int = 50
    authenticated_video_max_duration_seconds: int = 60

    # Analysis worker
    analysis_worker_poll_interval_seconds: int = 5
    analysis_worker_lease_seconds: int = 300

    # CORS
    cors_origins: list[str] = [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ]


settings = Settings()
