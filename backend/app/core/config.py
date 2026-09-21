from typing import Literal

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
    openai_visual_classifier_enabled: bool = True
    openai_visual_classifier_model: str = "gpt-5.6-luna"
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

    guest_video_max_size_mb: int = 50
    guest_video_max_duration_seconds: int = 60

    # Analysis worker
    analysis_worker_poll_interval_seconds: int = 5
    analysis_worker_lease_seconds: int = 300

    # CORS
    cors_origins: list[str] = [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ]


settings = Settings()
