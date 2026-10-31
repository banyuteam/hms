"""Pure functions: key canonicalisation, range digests, row diffs and range splitting.

No I/O here, so the core rules are unit-tested without databases.
"""

from __future__ import annotations

import datetime as dt
import json
import uuid
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Any, Iterable, Mapping, Sequence

Key = tuple[Any, ...]

# Marker written to cdc.row_state by `resync`: never equal to a real MD5, so every row re-applies.
RESYNC_HASH = "0" * 32

EVENT_NAMESPACE = uuid.UUID("6f1d3c3e-6a52-4c55-9b1e-2f0a6c8d4b10")


def _norm(value: Any) -> Any:
    if value is None or isinstance(value, (bool, int, str)):
        return value
    if isinstance(value, (dt.datetime, dt.date, dt.time)):
        return value.isoformat()
    if isinstance(value, dt.timedelta):  # MariaDB TIME via PyMySQL
        total = int(value.total_seconds())
        sign = "-" if total < 0 else ""
        total = abs(total)
        return f"{sign}{total // 3600:02d}:{total % 3600 // 60:02d}:{total % 60:02d}"
    if isinstance(value, (Decimal, float)):
        return str(value)
    if isinstance(value, (bytes, bytearray)):
        return "0x" + bytes(value).hex()
    raise TypeError(f"unsupported key type {type(value).__name__}")


def normalize_key(key: Sequence[Any]) -> list[Any]:
    """JSON-safe key values, usable again as MariaDB parameters."""
    return [_norm(v) for v in key]


def pk_key(key: Sequence[Any]) -> str:
    """Canonical text form of a key, used as cdc.row_state.pk_key."""
    return json.dumps(normalize_key(key), separators=(",", ":"), ensure_ascii=False)


def hash_prefix(row_hash: str) -> int:
    return int(row_hash[:16], 16)


def format_digest(value: int) -> str:
    return f"{value:016x}"


def digest_of(hashes: Iterable[str]) -> tuple[int, str]:
    """(row count, XOR of 64-bit hash prefixes) — bit-identical to sqlgen.digest_sql on MariaDB."""
    acc = 0
    n = 0
    for h in hashes:
        acc ^= hash_prefix(h)
        n += 1
    return n, format_digest(acc)


@dataclass
class RangeDiff:
    inserts: list[str] = field(default_factory=list)
    updates: list[str] = field(default_factory=list)
    deletes: list[str] = field(default_factory=list)

    @property
    def changed(self) -> bool:
        return bool(self.inserts or self.updates or self.deletes)


def diff_range(source: Mapping[str, str], target: Mapping[str, str]) -> RangeDiff:
    """Compare pk_key -> row_hash maps of one range (source snapshot vs cdc.row_state)."""
    result = RangeDiff()
    for key, h in source.items():
        before = target.get(key)
        if before is None:
            result.inserts.append(key)
        elif before != h:
            result.updates.append(key)
    result.deletes = [key for key in target if key not in source]
    return result


def split_boundaries(
    keys: Sequence[Key], size: int, strategy: str, lower: Key | None
) -> list[Key]:
    """New boundaries inside a range whose sorted keys outgrew 2 x size; [] when no split is needed.

    keyset:    a boundary every `size` keys, the last chunk taking the remainder (size .. 2*size-1).
    int_range: boundaries at multiples of `size` (fixed-width ranges), between the first and last key.
    """
    n = len(keys)
    if n <= 2 * size:
        return []
    if strategy == "keyset":
        bounds = []
        i = 1
        while (i + 1) * size <= n:
            bounds.append(tuple(keys[i * size]))
            i += 1
        return bounds
    if strategy == "int_range":
        first, last = int(keys[0][0]), int(keys[-1][0])
        start = first // size + 1
        bounds = [(m * size,) for m in range(start, last // size + 1)]
        if lower is not None:
            bounds = [b for b in bounds if b[0] > int(lower[0])]
        return bounds
    raise ValueError(f"unknown strategy {strategy}")


def int_range_boundaries(lo: int | None, hi: int | None, size: int) -> list[Key]:
    """Initial fixed-width boundaries for an integer key between MIN and MAX."""
    if lo is None or hi is None:
        return []
    return [(m * size,) for m in range(lo // size + 1, hi // size + 1)]


def boundaries_to_ranges(bounds: Sequence[Key]) -> list[tuple[Key | None, Key | None]]:
    """[b1, b2, ...] -> [(None, b1), (b1, b2), ..., (bn, None)]: covers the whole key space."""
    edges: list[Key | None] = [None, *bounds, None]
    return [(edges[i], edges[i + 1]) for i in range(len(edges) - 1)]


def event_id(
    table: str, key: str, op: str, before: str | None, after: str | None, pass_no: int, range_id: int
) -> uuid.UUID:
    """Deterministic event id: a retried range produces the same ids, so consumers can dedupe."""
    return uuid.uuid5(EVENT_NAMESPACE, f"{table}|{key}|{op}|{before}|{after}|{pass_no}|{range_id}")


def next_interval_s(changed: bool, streak: int, hot: int, cold: int, is_tail: bool) -> int:
    """Adaptive re-scan: changed or tail -> hot; each quiet scan doubles the interval up to cold."""
    if changed or is_tail:
        return hot
    return min(cold, hot * (2 ** min(streak, 30)))
