"""Structured JSON logging with PHI masking.

The engine only logs table names, range ids and counts. As a second line of defence a filter masks
anything that looks like a NIK (16 digits), BPJS card number (13 digits) or Indonesian phone number.
Use `key_ref()` when a log line must point at a specific key: it is a one-way pseudonym.
"""

from __future__ import annotations

import datetime as dt
import hashlib
import json
import logging
import re
import sys

_PATTERNS = (
    (re.compile(r"(?<!\d)\d{16}(?!\d)"), "[NIK]"),
    (re.compile(r"(?<!\d)\d{13}(?!\d)"), "[BPJS]"),
    (re.compile(r"(?<![\d])(?:\+?62|0)8\d{7,11}(?!\d)"), "[PHONE]"),
    # PostgreSQL error details echo key values, e.g. "Key (no_rawat)=(2026/...) already exists".
    (re.compile(r"\)=\((?:[^()]|\([^()]*\))*\)"), ")=([REDACTED])"),
)

_RESERVED = set(vars(logging.LogRecord("", 0, "", 0, "", None, None))) | {"message", "asctime"}


def mask_text(text: str) -> str:
    for pattern, replacement in _PATTERNS:
        text = pattern.sub(replacement, text)
    return text


def key_ref(pk_key: str) -> str:
    """Pseudonymous reference to a key for logs (not reversible, stable within a deployment)."""
    return "k:" + hashlib.sha256(pk_key.encode()).hexdigest()[:12]


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload = {
            "ts": dt.datetime.fromtimestamp(record.created, tz=dt.timezone.utc).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "msg": record.getMessage(),
        }
        for key, value in record.__dict__.items():
            if key not in _RESERVED and not key.startswith("_"):
                payload[key] = value
        if record.exc_info:
            payload["exc"] = self.formatException(record.exc_info)
        return mask_text(json.dumps(payload, default=str, ensure_ascii=False))


def setup_logging(level: str = "INFO") -> None:
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter())
    root = logging.getLogger()
    root.handlers[:] = [handler]
    root.setLevel(level)
