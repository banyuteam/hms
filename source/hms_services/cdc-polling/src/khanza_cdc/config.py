"""Runtime settings, read from environment variables (optionally loaded from a .env file).

Secrets never have defaults and are never logged. See .env.example for every variable.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

from dotenv import load_dotenv

PROJECT_ROOT = Path(__file__).resolve().parents[2]


class ConfigError(ValueError):
    """Raised when a required setting is missing or invalid."""


def _req(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise ConfigError(f"missing required environment variable {name}")
    return value


def _int(name: str, default: int) -> int:
    raw = os.environ.get(name, "").strip()
    if not raw:
        return default
    try:
        return int(raw)
    except ValueError as exc:
        raise ConfigError(f"{name} must be an integer, got {raw!r}") from exc


def _opt(name: str) -> str | None:
    value = os.environ.get(name, "").strip()
    return value or None


@dataclass(frozen=True)
class SourceSettings:
    """Khanza MariaDB replica. The user must be SELECT-only."""

    host: str
    port: int
    user: str
    password: str = field(repr=False)
    database: str
    ssl_ca: str | None = None
    connect_timeout_s: int = 10
    max_statement_time_s: int = 60
    max_replica_lag_s: int = 0  # 0 disables the replica-lag guard


@dataclass(frozen=True)
class TargetSettings:
    """PostgreSQL 18 database that holds the cdc and khanza_mirror schemas."""

    host: str
    port: int
    user: str
    password: str = field(repr=False)
    database: str
    sslmode: str = "prefer"

    def conninfo(self) -> str:
        from psycopg.conninfo import make_conninfo

        return make_conninfo(
            host=self.host,
            port=self.port,
            user=self.user,
            password=self.password,
            dbname=self.database,
            sslmode=self.sslmode,
            application_name="cdc-polling",
        )


@dataclass(frozen=True)
class EngineSettings:
    mappings_dir: Path
    max_ranges_per_pass: int = 200
    throttle_sleep_ms: int = 0
    max_source_rows_per_second: int = 0  # 0 = unlimited
    fetch_batch_size: int = 200
    idle_sleep_s: int = 5
    log_level: str = "INFO"


@dataclass(frozen=True)
class Settings:
    source: SourceSettings
    target: TargetSettings
    engine: EngineSettings


def load_env(env_file: Path | None = None) -> None:
    """Load a .env file into the process environment. Variables already set win over the file."""
    if env_file is not None:
        if not env_file.is_file():
            raise ConfigError(f"env file not found: {env_file}")
        load_dotenv(env_file, override=False)
        return
    for candidate in (Path.cwd() / ".env", PROJECT_ROOT / ".env"):
        if candidate.is_file():
            load_dotenv(candidate, override=False)
            return


def mappings_dir_from_env() -> Path:
    mappings_dir = Path(os.environ.get("CDC_MAPPINGS_DIR", "").strip() or PROJECT_ROOT / "mappings")
    if not mappings_dir.is_absolute():
        mappings_dir = (PROJECT_ROOT / mappings_dir).resolve()
    return mappings_dir


def load_settings(env_file: Path | None = None) -> Settings:
    """Load all settings (needs database credentials)."""
    load_env(env_file)
    mappings_dir = mappings_dir_from_env()
    return Settings(
        source=SourceSettings(
            host=_req("CDC_SOURCE_HOST"),
            port=_int("CDC_SOURCE_PORT", 3306),
            user=_req("CDC_SOURCE_USER"),
            password=_req("CDC_SOURCE_PASSWORD"),
            database=_req("CDC_SOURCE_DATABASE"),
            ssl_ca=_opt("CDC_SOURCE_SSL_CA"),
            connect_timeout_s=_int("CDC_SOURCE_CONNECT_TIMEOUT_S", 10),
            max_statement_time_s=_int("CDC_SOURCE_MAX_STATEMENT_TIME_S", 60),
            max_replica_lag_s=_int("CDC_MAX_REPLICA_LAG_S", 0),
        ),
        target=TargetSettings(
            host=_req("CDC_TARGET_HOST"),
            port=_int("CDC_TARGET_PORT", 5432),
            user=_req("CDC_TARGET_USER"),
            password=_req("CDC_TARGET_PASSWORD"),
            database=_req("CDC_TARGET_DATABASE"),
            sslmode=os.environ.get("CDC_TARGET_SSLMODE", "").strip() or "prefer",
        ),
        engine=EngineSettings(
            mappings_dir=mappings_dir,
            max_ranges_per_pass=_int("CDC_MAX_RANGES_PER_PASS", 200),
            throttle_sleep_ms=_int("CDC_THROTTLE_SLEEP_MS", 0),
            max_source_rows_per_second=_int("CDC_MAX_SOURCE_ROWS_PER_SECOND", 0),
            fetch_batch_size=_int("CDC_FETCH_BATCH_SIZE", 200),
            idle_sleep_s=_int("CDC_IDLE_SLEEP_S", 5),
            log_level=os.environ.get("CDC_LOG_LEVEL", "").strip().upper() or "INFO",
        ),
    )
