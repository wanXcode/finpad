from pydantic_settings import BaseSettings
from pathlib import Path


class Settings(BaseSettings):
    # App
    APP_NAME: str = "FinPad"
    DEBUG: bool = False
    SECRET_KEY: str = "change-me-in-production"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 1440  # 24h

    # Database
    DATABASE_URL: str = f"sqlite+aiosqlite:///{Path(__file__).parent.parent / 'data' / 'finpad.db'}"
    DB_PATH: str = str(Path(__file__).parent.parent / "data" / "finpad.db")

    # AI
    AI_API_BASE: str = "https://api.5666.net/v1"
    AI_API_KEY: str = ""
    AI_MODEL: str = "gpt-4o"

    # Default admin
    DEFAULT_USERNAME: str = "admin"
    DEFAULT_PASSWORD: str = "finpad2026"

    # Registration
    ALLOW_REGISTRATION: bool = True

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"


settings = Settings()
