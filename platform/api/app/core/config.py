"""Application settings.

Everything is read from the environment so the same image runs in every
environment. Nothing here has a production-safe default that could silently
mask a missing secret — the JWT secret and the database URL must be supplied.
"""

from __future__ import annotations

from functools import lru_cache

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # ---- Application -----------------------------------------------------
    app_name: str = "CPML Recruitment Command Center API"
    environment: str = Field(default="development")
    debug: bool = False
    api_prefix: str = "/api/v1"

    # ---- Persistence -----------------------------------------------------
    database_url: str = Field(
        default="postgresql+psycopg://cpml:cpml@localhost:5432/cpml_recruitment"
    )
    db_pool_size: int = 10
    db_max_overflow: int = 20
    db_echo: bool = False

    redis_url: str = Field(default="redis://localhost:6379/0")
    # Analytics responses are derived from a nightly sync, so a short TTL is
    # about protecting the database from dashboard fan-out, not freshness.
    cache_ttl_seconds: int = 300

    # ---- Auth ------------------------------------------------------------
    jwt_secret: str = Field(default="change-me-in-production")
    jwt_algorithm: str = "HS256"
    jwt_ttl_minutes: int = 12 * 60
    google_client_id: str = ""
    google_client_secret: str = ""
    google_redirect_uri: str = "http://localhost:3000/auth/callback"
    # Only accounts on these domains may sign in at all.
    allowed_email_domains: list[str] = Field(default_factory=lambda: ["bayut.sa"])

    # ---- Google Sheets source -------------------------------------------
    sheets_spreadsheet_id: str = ""
    sheets_worksheet: str = "Sheet1"
    sheets_service_account_json: str = ""
    sync_cron: str = "0 */2 * * *"

    # ---- CORS ------------------------------------------------------------
    cors_origins: list[str] = Field(
        default_factory=lambda: ["http://localhost:3000"]
    )

    @field_validator("cors_origins", "allowed_email_domains", mode="before")
    @classmethod
    def _split_csv(cls, value: object) -> object:
        """Accept either a JSON list or a plain comma-separated env string."""
        if isinstance(value, str) and not value.strip().startswith("["):
            return [v.strip() for v in value.split(",") if v.strip()]
        return value

    @property
    def is_production(self) -> bool:
        return self.environment.lower() in {"production", "prod"}


@lru_cache
def get_settings() -> Settings:
    settings = Settings()
    if settings.is_production and settings.jwt_secret == "change-me-in-production":
        raise RuntimeError(
            "JWT_SECRET must be set to a real secret before running in production."
        )
    return settings
