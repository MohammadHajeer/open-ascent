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

    # Stripe
    stripe_secret_key: str
    stripe_webhook_secret: str | None = None
    stripe_pro_price_id: str

    # Guest analysis
    guest_token_secret: str
    guest_analysis_expiry_minutes: int = 60
    guest_video_max_size_mb: int = 100
    guest_video_max_duration_seconds: int = 60

    # CORS
    cors_origins: list[str] = [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ]


settings = Settings()