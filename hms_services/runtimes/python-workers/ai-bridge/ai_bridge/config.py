"""Bootstrap configuration from the environment. Secrets come only from mounted files (*_FILE), never from values."""

from __future__ import annotations

import os
from dataclasses import dataclass


class ConfigError(Exception):
    """The configuration is unusable; the message names the setting, never a secret value."""


@dataclass(frozen=True)
class Config:
    host: str
    port: int
    bridge_secret: str
    provider_key_configured: bool
    documents_dir: str
    slots: int
    deadline_seconds: int


def _read_secret(path: str | None, name: str, required: bool) -> str:
    if not path:
        if required:
            raise ConfigError(f"{name} is required")
        return ""
    try:
        with open(path, encoding="utf-8") as f:
            value = f.read().strip()
    except OSError as e:
        raise ConfigError(f"{name} cannot be read") from e
    if required and not value:
        raise ConfigError(f"{name} is empty")
    return value


def _int(env: dict[str, str], name: str, default: int, low: int, high: int) -> int:
    raw = env.get(name, "").strip()
    if not raw:
        return default
    try:
        n = int(raw)
    except ValueError as e:
        raise ConfigError(f"{name} must be an integer") from e
    if not low <= n <= high:
        raise ConfigError(f"{name} must be between {low} and {high}")
    return n


def load(env: dict[str, str] | None = None) -> Config:
    env = dict(os.environ if env is None else env)
    addr = env.get("BRIDGE_ADDR", "0.0.0.0:8090").strip()
    host, _, port = addr.rpartition(":")
    if not host or not port.isdigit():
        raise ConfigError("BRIDGE_ADDR must be host:port")
    secret = _read_secret(env.get("BRIDGE_SECRET_FILE"), "BRIDGE_SECRET_FILE", required=True)
    if len(secret) < 32:
        raise ConfigError("BRIDGE_SECRET_FILE must hold at least 32 characters")
    # The provider key may be absent in development: the bridge then reports not ready and answers not_configured.
    key = _read_secret(env.get("ANTHROPIC_API_KEY_FILE"), "ANTHROPIC_API_KEY_FILE", required=False)
    return Config(
        host=host,
        port=int(port),
        bridge_secret=secret,
        provider_key_configured=bool(key),
        documents_dir=env.get("DOCUMENTS_DIR", "/data/assistant-documents").strip(),
        slots=_int(env, "BRIDGE_SLOTS", 4, 1, 32),
        deadline_seconds=_int(env, "BRIDGE_DEADLINE_SECONDS", 120, 10, 600),
    )
