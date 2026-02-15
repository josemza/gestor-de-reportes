from __future__ import annotations

from pathlib import Path
import os
from pydantic import BaseModel, Field, ValidationError, field_validator, model_validator
from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent
ENV_PATH = BASE_DIR / ".env"
load_dotenv(dotenv_path=ENV_PATH,override=True)

class Settings(BaseModel):
    APP_NAME: str = Field(default="Reporteador GCI")
    API_HOST: str = Field(default="0.0.0.0")
    API_PORT: int = Field(default=8037)

    WORKER_POLL_SECONDS: int = Field(default=3)
    WORKER_ID: str = Field(default="worker-01")
    WORKER_JOB_TIMEOUT_SECONDS: int = Field(default=3600)
    WORKER_LOCK_HEARTBEAT_SECONDS: int = Field(default=10)
    WORKER_LOCK_STALE_SECONDS: int = Field(default=60)
    WORKER_LOG_DIR: str = Field(default="./runtime/worker_logs")
    WORKER_USE_SHELL: bool = Field(default=True)

    JWT_SECRET_KEY: str = Field(default="CAMBIA_ESTE_SECRETO")
    JWT_ALGORITHM: str = Field(default="HS256")
    JWT_ACCESS_TOKEN_MINUTES: int = Field(default=30)
    DEFAULT_USER_PASSWORD: str = Field(default="Temporal123!")

    @field_validator("API_PORT",mode="before")
    @classmethod
    def validate_api_port(cls, v: int) -> int:
        if isinstance(v,str):
            v = v.strip()
        try:
            v = int(v)
        except (TypeError, ValueError):
            raise ValueError(f"API_PORT invalido: {v!r}. Debe ser entero.")
        if not (1 <= v <= 65535):
            raise ValueError("API_PORT debe estar entre 1 y 65535")
        return v
    
    @field_validator("WORKER_POLL_SECONDS",mode="before")
    @classmethod
    def validate_poll_seconds(cls, v: int) -> int:
        try:
            v = int(v)
        except (TypeError, ValueError):
            raise ValueError(f"WORKER_POLL_SECONDS invalido: {v!r}. Debe ser entero.")
        if v < 1:
            raise ValueError("WORKER_POLL_SECONDS debe ser >= 1")
        return v

    @field_validator("WORKER_LOCK_HEARTBEAT_SECONDS", "WORKER_LOCK_STALE_SECONDS", mode="before")
    @classmethod
    def validate_positive_worker_lock_values(cls, v: int) -> int:
        try:
            v = int(v)
        except (TypeError, ValueError):
            raise ValueError(f"Valor invalido: {v!r}. Debe ser entero.")
        if v < 1:
            raise ValueError("El valor debe ser >= 1")
        return v

    @model_validator(mode="after")
    def validate_lock_windows(self) -> "Settings":
        if self.WORKER_LOCK_STALE_SECONDS <= self.WORKER_LOCK_HEARTBEAT_SECONDS:
            raise ValueError("WORKER_LOCK_STALE_SECONDS debe ser mayor que WORKER_LOCK_HEARTBEAT_SECONDS")
        return self
    
def _env(name: str, default: str | None = None) -> str | None:
    val = os.getenv(name)
    if val is None or val == "":
        return default
    return val
    
def get_settings() -> Settings:
    raw = {
        "APP_NAME": _env("APP_NAME", "Reporteador GCI"),
        "API_HOST": _env("API_HOST", "0.0.0.0"),
        "API_PORT": _env("API_PORT", "8000"),
        "WORKER_POLL_SECONDS": _env("WORKER_POLL_SECONDS", "3"),
        "WORKER_ID": _env("WORKER_ID","worker-01"),
        "WORKER_JOB_TIMEOUT_SECONDS": _env("WORKER_JOB_TIMEOUT_SECONDS", "3600"),
        "WORKER_LOCK_HEARTBEAT_SECONDS": _env("WORKER_LOCK_HEARTBEAT_SECONDS", "10"),
        "WORKER_LOCK_STALE_SECONDS": _env("WORKER_LOCK_STALE_SECONDS", "60"),
        "WORKER_LOG_DIR": _env("WORKER_LOG_DIR", "./runtime/worker_logs"),
        "WORKER_USE_SHELL": _env("WORKER_USE_SHELL", "true"),
        "JWT_SECRET_KEY": _env("JWT_SECRET_KEY", "CAMBIA_ESTE_SECRETO"),
        "JWT_ALGORITHM": _env("JWT_ALGORITHM", "HS256"),
        "JWT_ACCESS_TOKEN_MINUTES": _env("JWT_ACCESS_TOKEN_MINUTES", "30"),
        "DEFAULT_USER_PASSWORD": _env("DEFAULT_USER_PASSWORD", "Temporal123!"),
    }
    try:
        return Settings(**raw)
    except ValidationError as e:
        raise RuntimeError(f"Error de configuracion: {e}") from e
    
settings = get_settings()
